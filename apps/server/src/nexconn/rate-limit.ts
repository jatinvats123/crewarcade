// Token-bucket rate limiter, one per Nexconn endpoint family. acquire() waits (in FIFO order) until
// enough tokens are available, so bursts queue up instead of hitting HTTP 429 / code 1008.
// Clock and sleep are injected so tests run on fake time.

export interface RateLimiter {
  /** Resolves when `cost` requests may be sent. */
  acquire(cost?: number): Promise<void>;
}

export interface TokenBucketOptions {
  ratePerSec: number;
  /** Bucket size (max burst). Defaults to ratePerSec. */
  burst?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export function tokenBucket({ ratePerSec, burst = ratePerSec, now = Date.now, sleep = realSleep }: TokenBucketOptions): RateLimiter {
  if (ratePerSec <= 0 || burst <= 0) throw new Error('rate and burst must be positive');
  let tokens = burst;
  let last = now();
  let queue: Promise<void> = Promise.resolve();

  const refill = () => {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * ratePerSec);
    last = t;
  };

  return {
    acquire(cost = 1) {
      if (cost > burst) cost = burst; // a 3-channel send on a 2-token bucket must still go out
      const turn = queue.then(async () => {
        for (;;) {
          refill();
          if (tokens >= cost) {
            tokens -= cost;
            return;
          }
          await sleep(Math.max(1, Math.ceil(((cost - tokens) / ratePerSec) * 1000)));
        }
      });
      queue = turn.catch(() => {});
      return turn;
    },
  };
}

/**
 * Rate limits per App Key from the Nexconn endpoint list (2026-11-13). Group message send, group
 * streaming and group metadata share one 20/s quota ("Rate limits > Known issues").
 */
export const NEXCONN_BUCKETS = {
  /** /v4/group-channel/message/send, .../stream/send, metadata set/delete on group messages. */
  groupMessage: 20,
  /** /v4/direct-channel/message/send: 6,000 per minute. */
  directMessage: 100,
  /** /v4/auth/access-token/issue. */
  token: 200,
  /** Everything else (group create/join, open channels...). */
  default: 100,
} as const;
export type NexconnBucket = keyof typeof NEXCONN_BUCKETS;

export function createNexconnLimiters(opts: Omit<TokenBucketOptions, 'ratePerSec' | 'burst'> = {}): Record<NexconnBucket, RateLimiter> {
  const entries = Object.entries(NEXCONN_BUCKETS).map(([k, rate]) => [k, tokenBucket({ ...opts, ratePerSec: rate })]);
  return Object.fromEntries(entries) as Record<NexconnBucket, RateLimiter>;
}

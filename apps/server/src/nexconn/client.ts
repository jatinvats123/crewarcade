// Typed, signed Platform Chat API client (server only: it holds the App Secret).
// Docs: /platform-chat-api/prepare-to-use-api/auth.md (signing), base-url.md (failover), limits.md.
//  - Every call is POST with App-Key, Nonce (<= 18 chars), Timestamp (ms) and
//    Signature = sha1(AppSecret + Nonce + Timestamp), plus a fresh X-Request-ID.
//  - Failover: on a timeout (5 s) or an unexpected HTTP status, switch to the other domain and
//    remember the switch.
//  - Retries with full jitter on network errors, timeouts, 5xx, HTTP 429 and business code 1008.
//  - Each endpoint family waits on its own token bucket (rate-limit.ts).
//  - Responses are zod-validated; `code != 0` throws NexconnApiError.
import type { z } from 'zod';
import { nexconnSignature, randomAlnum } from '../crypto';
import { NexconnApiError, NexconnUnavailableError } from './errors';
import { createNexconnLimiters, type NexconnBucket, type RateLimiter } from './rate-limit';

export interface FetchResponseLike {
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<FetchResponseLike>;

export interface NexconnLog {
  debug(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface NexconnClientOptions {
  appKey: string;
  appSecret: string;
  /** [primary, backup], e.g. https://api.sg-light-api.com and https://api-b.sg-light-api.com */
  baseUrls: readonly [string, string];
  fetch?: FetchLike;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Backoff: full jitter in [0, min(cap, base * 2^(attempt-1))). */
  backoffBaseMs?: number;
  backoffCapMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  limiters?: Record<NexconnBucket, RateLimiter>;
  log?: NexconnLog;
}

export interface PostOptions {
  bucket?: NexconnBucket;
  /** Requests this call counts as (a send to 3 channels costs 3). */
  cost?: number;
}

/** Business code for "rate limit exceeded" (retryable). */
export const CODE_RATE_LIMITED = 1008;

const noopLog: NexconnLog = { debug: () => {}, warn: () => {} };
const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class NexconnClient {
  private active = 0;
  private readonly bases: readonly [string, string];
  private readonly fetchImpl: FetchLike;
  private readonly limiters: Record<NexconnBucket, RateLimiter>;
  private readonly log: NexconnLog;

  constructor(private readonly o: NexconnClientOptions) {
    this.bases = [o.baseUrls[0].replace(/\/+$/, ''), o.baseUrls[1].replace(/\/+$/, '')];
    this.fetchImpl = o.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.limiters = o.limiters ?? createNexconnLimiters({ ...(o.now && { now: o.now }), ...(o.sleep && { sleep: o.sleep }) });
    this.log = o.log ?? noopLog;
  }

  get appKey(): string {
    return this.o.appKey;
  }

  /** The domain currently in use (after any failover). */
  get activeBaseUrl(): string {
    return this.bases[this.active as 0 | 1];
  }

  /** Fresh signed headers for one request. */
  signHeaders(): Record<string, string> {
    const nonce = randomAlnum(16);
    const timestamp = String((this.o.now ?? Date.now)());
    return {
      'App-Key': this.o.appKey,
      Nonce: nonce,
      Timestamp: timestamp,
      Signature: nexconnSignature(this.o.appSecret, nonce, timestamp),
      'X-Request-ID': randomAlnum(32),
      'Content-Type': 'application/json',
    };
  }

  async post<S extends z.ZodType>(path: string, body: unknown, schema: S, opts: PostOptions = {}): Promise<z.infer<S>> {
    const maxAttempts = this.o.maxAttempts ?? 3;
    const timeoutMs = this.o.timeoutMs ?? 5000;
    const payload = JSON.stringify(body);
    let lastProblem = 'no attempt made';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.limiters[opts.bucket ?? 'default'].acquire(opts.cost ?? 1);
      const base = this.activeBaseUrl;
      const headers = this.signHeaders();
      const ctx = { path, attempt, base, requestId: headers['X-Request-ID'] };

      let status: number;
      let text: string;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await this.fetchImpl(`${base}${path}`, { method: 'POST', headers, body: payload, signal: ac.signal });
        status = res.status;
        text = await res.text();
      } catch (e) {
        lastProblem = ac.signal.aborted ? `timeout after ${timeoutMs} ms` : `network error: ${(e as Error).message}`;
        this.log.warn({ ...ctx, problem: lastProblem }, 'nexconn: request failed, switching domain');
        this.switchDomain();
        await this.backoff(attempt, maxAttempts);
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (status === 429) {
        lastProblem = 'HTTP 429 rate limited';
        this.log.warn({ ...ctx, status }, 'nexconn: rate limited, retrying');
        await this.backoff(attempt, maxAttempts);
        continue;
      }
      if (status >= 500) {
        lastProblem = `HTTP ${status}`;
        this.log.warn({ ...ctx, status }, 'nexconn: server error, switching domain');
        this.switchDomain();
        await this.backoff(attempt, maxAttempts);
        continue;
      }

      const json = parseJson(text);
      const code = typeof json === 'object' && json !== null && typeof (json as { code?: unknown }).code === 'number' ? (json as { code: number }).code : null;
      if (code === null) {
        if (status === 401) throw new NexconnApiError(path, 401, status, 'signature rejected (check NEXCONN_APP_SECRET)');
        // Not a Nexconn answer (proxy page, 404 HTML...): an "unexpected HTTP status" per the failover guide.
        lastProblem = `unexpected HTTP ${status} without a Nexconn body`;
        this.log.warn({ ...ctx, status }, 'nexconn: unexpected response, switching domain');
        this.switchDomain();
        await this.backoff(attempt, maxAttempts);
        continue;
      }
      if (code === CODE_RATE_LIMITED) {
        lastProblem = 'code 1008 rate limited';
        this.log.warn({ ...ctx, code }, 'nexconn: rate limited, retrying');
        await this.backoff(attempt, maxAttempts);
        continue;
      }
      if (code !== 0) {
        const msg = String((json as { errorMessage?: unknown; msg?: unknown }).errorMessage ?? (json as { msg?: unknown }).msg ?? '');
        this.log.warn({ ...ctx, status, code }, 'nexconn: API error');
        throw new NexconnApiError(path, code, status, msg.slice(0, 300));
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) throw new NexconnApiError(path, -1, status, `unexpected response shape: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      this.log.debug({ ...ctx, status }, 'nexconn: ok');
      return parsed.data;
    }
    throw new NexconnUnavailableError(path, maxAttempts, lastProblem);
  }

  private switchDomain() {
    this.active = this.active === 0 ? 1 : 0;
  }

  private async backoff(attempt: number, maxAttempts: number) {
    if (attempt >= maxAttempts) return;
    const base = this.o.backoffBaseMs ?? 250;
    const cap = this.o.backoffCapMs ?? 2000;
    const ms = Math.floor((this.o.random ?? Math.random)() * Math.min(cap, base * 2 ** (attempt - 1)));
    await (this.o.sleep ?? realSleep)(ms);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

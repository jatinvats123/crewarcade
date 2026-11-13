// Agent job queue. Production: pg-boss (Postgres-backed, survives restarts). Tests and local runs
// without workers: an in-memory queue with the same rules. Rules:
//  - idempotent: the job id is derived from the Nexconn messageId (or another stable key), so a
//    webhook retry or a double tap never enqueues the same work twice;
//  - at most AGENT_CONCURRENCY jobs at once per process;
//  - at most ONE job per room (channelId) at a time, so agents never talk over each other.
import { createHash } from 'node:crypto';
import { PgBoss, type ConstructorOptions } from 'pg-boss';
import { z } from 'zod';

export const AgentJobData = z.object({
  /** Stable key for idempotency (the triggering messageId, or "<cardMessageId>:approve"...). */
  key: z.string().min(1).max(200),
  crewId: z.string(),
  channelId: z.string(),
  messageId: z.string().nullable(),
  /** DB user id of the human who triggered it. */
  fromUserId: z.string(),
  agent: z.enum(['pixel', 'forge', 'glitch']),
  intent: z.enum(['plan', 'change', 'explain', 'remix', 'bug', 'chat']),
  text: z.string().max(4000),
  attachments: z
    .array(z.object({ kind: z.enum(['image', 'voice']), url: z.string() }))
    .max(4)
    .default([]),
  remix: z.object({ source: z.string(), idea: z.string() }).optional(),
  /** For change requests from the [Change] button: the plan card being changed. */
  cardMessageId: z.string().optional(),
});
export type AgentJobData = z.infer<typeof AgentJobData>;

/** Forge's build queue (Phase 3 runs it). Jobs wait here until then. */
export const BuildJobData = z.object({
  key: z.string(),
  gameId: z.string(),
  version: z.number().int().min(1),
  channelId: z.string(),
  handoffMessageId: z.string(),
});
export type BuildJobData = z.infer<typeof BuildJobData>;

export const QUEUES = { agent: 'agent', build: 'forge-build' } as const;

export interface JobQueue {
  /** false when a job with the same key was already enqueued. */
  enqueueAgent(job: AgentJobData): Promise<boolean>;
  enqueueBuild(job: BuildJobData): Promise<boolean>;
  /** Starts processing agent jobs with this handler. */
  start(handler: (job: AgentJobData) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

/** pg-boss ids are UUIDs: derive one deterministically from the idempotency key. */
export function jobUuid(key: string): string {
  const h = createHash('sha256').update(`crewarcade:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface QueueLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** `connection`: a Postgres URL (production), or pg-boss options such as an adapter `db` (tests on PGlite). */
export function createPgBossQueue(
  connection: string | ConstructorOptions,
  opts: { concurrency: number; log: QueueLog; pollingIntervalSeconds?: number },
): JobQueue {
  const boss = new PgBoss(typeof connection === 'string' ? { connectionString: connection, max: 4 } : connection);
  boss.on('error', err => opts.log.error({ err }, 'pg-boss error'));
  let started: Promise<void> | null = null;
  const ready = () =>
    (started ??= (async () => {
      await boss.start();
      await boss.createQueue(QUEUES.agent, { retryLimit: 1, retryDelay: 5, expireInSeconds: 5 * 60 });
      await boss.createQueue(QUEUES.build, { retryLimit: 2, retryDelay: 10, expireInSeconds: 15 * 60 });
    })());

  return {
    async enqueueAgent(job) {
      await ready();
      const id = await boss.send(QUEUES.agent, AgentJobData.parse(job), { id: jobUuid(job.key), group: { id: job.channelId } });
      return id !== null;
    },
    async enqueueBuild(job) {
      await ready();
      const id = await boss.send(QUEUES.build, BuildJobData.parse(job), { id: jobUuid(job.key), group: { id: job.channelId } });
      return id !== null;
    },
    async start(handler) {
      await ready();
      await boss.work<AgentJobData>(
        QUEUES.agent,
        {
          localConcurrency: opts.concurrency,
          groupConcurrency: 1,
          batchSize: 1,
          ...(opts.pollingIntervalSeconds && { pollingIntervalSeconds: opts.pollingIntervalSeconds }),
        },
        async jobs => {
          for (const j of jobs) await handler(AgentJobData.parse(j.data));
        },
      );
      opts.log.info({ concurrency: opts.concurrency }, 'agent worker started (pg-boss)');
    },
    async stop() {
      if (started) await boss.stop({ graceful: true, timeout: 20_000 });
    },
  };
}

/**
 * In-memory queue with the same rules (idempotency, concurrency, one job per room). Used by tests
 * and when no job database is available. Not durable: jobs are lost on restart.
 */
export function createMemoryQueue(opts: { concurrency: number; log?: QueueLog }): JobQueue & { idle: () => Promise<void>; builds: BuildJobData[] } {
  const seen = new Set<string>();
  const pending: AgentJobData[] = [];
  const busyRooms = new Set<string>();
  const builds: BuildJobData[] = [];
  let running = 0;
  let handler: ((job: AgentJobData) => Promise<void>) | null = null;
  let waiters: Array<() => void> = [];

  const settleIdle = () => {
    if (running === 0 && pending.length === 0) {
      const w = waiters;
      waiters = [];
      for (const f of w) f();
    }
  };

  const pump = () => {
    if (!handler) return;
    while (running < opts.concurrency) {
      const i = pending.findIndex(j => !busyRooms.has(j.channelId));
      if (i === -1) break;
      const job = pending.splice(i, 1)[0]!;
      busyRooms.add(job.channelId);
      running++;
      const h = handler;
      void (async () => {
        try {
          await h(job);
        } catch (err) {
          opts.log?.error({ err, key: job.key }, 'agent job failed');
        } finally {
          running--;
          busyRooms.delete(job.channelId);
          pump();
          settleIdle();
        }
      })();
    }
  };

  return {
    builds,
    async enqueueAgent(job) {
      const parsed = AgentJobData.parse(job);
      if (seen.has(parsed.key)) return false;
      seen.add(parsed.key);
      pending.push(parsed);
      pump();
      return true;
    },
    async enqueueBuild(job) {
      const key = `build:${job.key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      builds.push(BuildJobData.parse(job));
      return true;
    },
    async start(h) {
      handler = h;
      pump();
    },
    async stop() {
      handler = null;
    },
    idle: () =>
      new Promise<void>(resolve => {
        waiters.push(resolve);
        settleIdle();
      }),
  };
}

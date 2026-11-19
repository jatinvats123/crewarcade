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
  /** Phase 5: a voice note, transcribed (Sarvam) and then routed like a text message. */
  voice: z
    .object({
      url: z.string().url().max(2048),
      durationS: z.number().min(0).max(3600),
      relayed: z.boolean().default(false),
      mentionedUserIds: z.array(z.string().max(64)).max(30).default([]),
    })
    .optional(),
  /** Times this job was re-queued because the AI model stayed busy (max BUSY_REQUEUES). */
  busyRetry: z.number().int().min(0).max(5).optional(),
});
export type AgentJobData = z.infer<typeof AgentJobData>;
/** A job whose AI model stays busy (after the client's own retries and fallback) is re-queued this often. */
export const BUSY_REQUEUES = 2;
export const BUSY_REQUEUE_DELAY_S = 45;

/** Forge's build queue: one job per version (or per retry of a failed version). */
export const BuildJobData = z.object({
  key: z.string(),
  gameId: z.string(),
  version: z.number().int().min(1),
  channelId: z.string(),
  handoffMessageId: z.string(),
  /** First build, a change request, a remix's v1, a retry after a failed build, or a fix of failed playtest checks. */
  reason: z.enum(['build', 'change', 'remix', 'retry', 'fix', 'hotfix']).default('build'),
  /** DB user id of the human whose action led here (usage is charged to them). */
  requestedBy: z.string().optional(),
});
export type BuildJobData = z.infer<typeof BuildJobData>;

/** Glitch's playtest queue: one job per built version, one playtest per room at a time. */
export const PlaytestJobData = z.object({
  key: z.string(),
  gameId: z.string(),
  version: z.number().int().min(1),
  channelId: z.string(),
  handoffMessageId: z.string(),
  /** Phase 5: set for a bug repro run (handoffMessageId is then the BugCard). */
  bugId: z.string().optional(),
});
export type PlaytestJobData = z.infer<typeof PlaytestJobData>;

export const QUEUES = { agent: 'agent', build: 'forge-build', playtest: 'glitch-playtest' } as const;

export interface JobQueue {
  /** false when a job with the same key was already enqueued. */
  enqueueAgent(job: z.input<typeof AgentJobData>, opts?: { delaySec?: number }): Promise<boolean>;
  enqueueBuild(job: z.input<typeof BuildJobData>): Promise<boolean>;
  enqueuePlaytest(job: PlaytestJobData): Promise<boolean>;
  /** Starts processing agent jobs with this handler. */
  start(handler: (job: AgentJobData) => Promise<void>): Promise<void>;
  /** Starts processing build jobs (one per room at a time). */
  startBuilds(handler: (job: BuildJobData) => Promise<void>): Promise<void>;
  /** Starts processing playtest jobs (one per room at a time). */
  startPlaytests(handler: (job: PlaytestJobData) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  /** Jobs waiting and running per queue (/admin). */
  depth(): Promise<QueueDepth>;
}

export type QueueDepth = Record<'agent' | 'build' | 'playtest', { queued: number; active: number }>;

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
      await boss.createQueue(QUEUES.build, { retryLimit: 1, retryDelay: 10, expireInSeconds: 15 * 60 });
      await boss.createQueue(QUEUES.playtest, { retryLimit: 1, retryDelay: 10, expireInSeconds: 10 * 60 });
    })());

  return {
    async enqueueAgent(job, opts) {
      await ready();
      const id = await boss.send(QUEUES.agent, AgentJobData.parse(job), {
        id: jobUuid(job.key),
        group: { id: job.channelId },
        ...(opts?.delaySec && { startAfter: opts.delaySec }),
      });
      return id !== null;
    },
    async enqueueBuild(job) {
      await ready();
      const id = await boss.send(QUEUES.build, BuildJobData.parse(job), { id: jobUuid(job.key), group: { id: job.channelId } });
      return id !== null;
    },
    async enqueuePlaytest(job) {
      await ready();
      const id = await boss.send(QUEUES.playtest, PlaytestJobData.parse(job), { id: jobUuid(`playtest:${job.key}`), group: { id: job.channelId } });
      return id !== null;
    },
    async startBuilds(handler) {
      await ready();
      await boss.work<BuildJobData>(
        QUEUES.build,
        {
          localConcurrency: Math.max(1, Math.min(2, opts.concurrency)),
          groupConcurrency: 1,
          batchSize: 1,
          ...(opts.pollingIntervalSeconds && { pollingIntervalSeconds: opts.pollingIntervalSeconds }),
        },
        async jobs => {
          for (const j of jobs) await handler(BuildJobData.parse(j.data));
        },
      );
      opts.log.info({}, 'build worker started (pg-boss)');
    },
    async startPlaytests(handler) {
      await ready();
      await boss.work<PlaytestJobData>(
        QUEUES.playtest,
        {
          localConcurrency: 1,
          groupConcurrency: 1,
          batchSize: 1,
          ...(opts.pollingIntervalSeconds && { pollingIntervalSeconds: opts.pollingIntervalSeconds }),
        },
        async jobs => {
          for (const j of jobs) await handler(PlaytestJobData.parse(j.data));
        },
      );
      opts.log.info({}, 'playtest worker started (pg-boss)');
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
    async depth() {
      await ready();
      const one = async (name: string) => {
        const q = await boss.getQueue(name);
        return { queued: q?.queuedCount ?? 0, active: q?.activeCount ?? 0 };
      };
      return { agent: await one(QUEUES.agent), build: await one(QUEUES.build), playtest: await one(QUEUES.playtest) };
    },
  };
}

/**
 * In-memory queue with the same rules (idempotency, concurrency, one job per room). Used by tests
 * and when no job database is available. Not durable: jobs are lost on restart.
 */
export function createMemoryQueue(opts: {
  concurrency: number;
  log?: QueueLog;
  /** Real wait for a delayed job (tests pass () => 0). Default: delaySec seconds. */
  delayMs?: (delaySec: number) => number;
}): JobQueue & { idle: () => Promise<void>; builds: BuildJobData[]; playtests: PlaytestJobData[] } {
  const seen = new Set<string>();
  type Item = { kind: 'agent'; job: AgentJobData } | { kind: 'build'; job: BuildJobData } | { kind: 'playtest'; job: PlaytestJobData };
  const pending: Item[] = [];
  const busyRooms = new Set<string>();
  const builds: BuildJobData[] = [];
  const playtests: PlaytestJobData[] = [];
  let running = 0;
  let handler: ((job: AgentJobData) => Promise<void>) | null = null;
  let buildHandler: ((job: BuildJobData) => Promise<void>) | null = null;
  let playtestHandler: ((job: PlaytestJobData) => Promise<void>) | null = null;
  const handlerFor = (it: Item) => (it.kind === 'agent' ? handler : it.kind === 'build' ? buildHandler : playtestHandler);
  let waiters: Array<() => void> = [];

  let delayed = 0;
  const settleIdle = () => {
    // Jobs without a registered handler (builds when no build worker runs) just wait.
    if (running === 0 && delayed === 0 && pending.every(it => !handlerFor(it))) {
      const w = waiters;
      waiters = [];
      for (const f of w) f();
    }
  };

  const pump = () => {
    while (running < opts.concurrency) {
      // One agent, one build and one playtest job per room at a time (as pg-boss groups per queue).
      const i = pending.findIndex(it => !!handlerFor(it) && !busyRooms.has(`${it.kind}|${it.job.channelId}`));
      if (i === -1) break;
      const it = pending.splice(i, 1)[0]!;
      const lock = `${it.kind}|${it.job.channelId}`;
      busyRooms.add(lock);
      running++;
      const run = it.kind === 'agent' ? () => handler!(it.job) : it.kind === 'build' ? () => buildHandler!(it.job) : () => playtestHandler!(it.job);
      void (async () => {
        try {
          await run();
        } catch (err) {
          opts.log?.error({ err, key: it.job.key }, `${it.kind} job failed`);
        } finally {
          running--;
          busyRooms.delete(lock);
          pump();
          settleIdle();
        }
      })();
    }
  };

  return {
    builds,
    playtests,
    async enqueueAgent(job, enq) {
      const parsed = AgentJobData.parse(job);
      if (seen.has(parsed.key)) return false;
      seen.add(parsed.key);
      const add = () => {
        pending.push({ kind: 'agent', job: parsed });
        pump();
      };
      if (enq?.delaySec) {
        delayed++;
        setTimeout(
          () => {
            delayed--;
            add();
          },
          (opts.delayMs ?? (sec => sec * 1000))(enq.delaySec),
        ).unref();
      } else add();
      return true;
    },
    async enqueueBuild(job) {
      const key = `build:${job.key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      const parsed = BuildJobData.parse(job);
      builds.push(parsed);
      pending.push({ kind: 'build', job: parsed });
      pump();
      return true;
    },
    async enqueuePlaytest(job) {
      const key = `playtest:${job.key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      const parsed = PlaytestJobData.parse(job);
      playtests.push(parsed);
      pending.push({ kind: 'playtest', job: parsed });
      pump();
      return true;
    },
    async start(h) {
      handler = h;
      pump();
    },
    async startBuilds(h) {
      buildHandler = h;
      pump();
    },
    async startPlaytests(h) {
      playtestHandler = h;
      pump();
    },
    async stop() {
      handler = null;
      buildHandler = null;
      playtestHandler = null;
    },
    async depth() {
      const count = (kind: Item['kind']) => ({
        queued: pending.filter(it => it.kind === kind).length,
        active: [...busyRooms].filter(l => l.startsWith(`${kind}|`)).length,
      });
      return { agent: count('agent'), build: count('build'), playtest: count('playtest') };
    },
    idle: () =>
      new Promise<void>(resolve => {
        waiters.push(resolve);
        settleIdle();
      }),
  };
}

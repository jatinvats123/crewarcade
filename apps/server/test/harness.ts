// Test harness: the real app on PGlite (real migrations + agent seed) with a fake Nexconn that
// records every Platform Chat API call and answers like the docs.
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createAgentServices } from '../src/agents';
import { runBuildJob } from '../src/agents/forge-runtime';
import { runGlitchJob } from '../src/agents/bugs';
import type { Playtester } from '../src/agents/smoke';
import { createMemoryStorage } from '../src/storage';
import { createMemoryQueue } from '../src/agents/queue';
import { handleAgentJob } from '../src/agents/runtime';
import type { AgentServices } from '../src/agents/runtime-deps';
import { createFakeAiClient } from '../src/ai/fake';
import type { AiClient } from '../src/ai/claude';
import type { SpeechToText } from '../src/ai/sarvam';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { Ctx } from '../src/context';
import { nexconnSignature } from '../src/crypto';
import { schema } from '../src/db/schema';
import { seedAgents } from '../src/db/seed-agents';
import type { Db } from '../src/db/types';
import { NexconnClient, type FetchLike } from '../src/nexconn';

export const WEB = 'https://web.test';
export const APP_KEY = 'testAppKey';
export const APP_SECRET = 'testAppSecret';
export const ENC_KEY = Buffer.alloc(32, 9).toString('base64');

export interface NexconnCall {
  path: string;
  body: Record<string, unknown>;
}

export interface Harness {
  app: FastifyInstance;
  db: Db;
  pg: PGlite;
  calls: NexconnCall[];
  storage: ReturnType<typeof createMemoryStorage>;
  clips: ReturnType<typeof createMemoryStorage>;
  uploads: ReturnType<typeof createMemoryStorage>;
  /** Make the next call to `path` fail with this business code. */
  failNext: (path: string, code: number) => void;
  /** Await background work (webhook processing). */
  flush: () => Promise<void>;
  close: () => Promise<void>;
  now: { t: number };
  /** Present with { agents: true }: memory queue + fake (or given) AI, worker started. */
  agents: (AgentServices & { queue: ReturnType<typeof createMemoryQueue> }) | null;
  /** Waits for background webhook work and every queued agent job. */
  settle: () => Promise<void>;
  /** POSTs a signed webhook event. */
  webhook: (type: string, data: Array<Record<string, unknown>>, id?: string) => Promise<LightMyRequestResponse>;
  ctx: () => Ctx;
}

export async function createHarness(
  opts: {
    nexconn?: boolean;
    agents?: boolean;
    builds?: boolean;
    playtester?: Playtester;
    ai?: AiClient | null;
    stt?: SpeechToText;
    env?: Record<string, string>;
    /** Local UI checks only (scripts/local-stack.ts): talk to a REAL Nexconn app instead of the fake. Never in tests. */
    realNexconn?: { appKey: string; appSecret: string; baseUrls: readonly [string, string] };
  } = {},
): Promise<Harness> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrate(drizzle(pg, { schema, casing: 'snake_case' }), { migrationsFolder: path.resolve(import.meta.dirname, '..', 'drizzle') });
  await seedAgents(db, WEB);

  const calls: NexconnCall[] = [];
  const failures = new Map<string, number>();
  let msg = 0;
  const fetch: FetchLike = async (url, init) => {
    const p = new URL(url).pathname;
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ path: p, body });
    const fail = failures.get(p);
    if (fail !== undefined) {
      failures.delete(p);
      return { status: 200, text: async () => JSON.stringify({ code: fail, errorMessage: 'forced failure' }) };
    }
    let res: unknown = { code: 0 };
    if (p === '/v4/auth/access-token/issue')
      res = { code: 0, result: { userId: body.userId, accessToken: `token-for-${String(body.userId)}-${calls.length}` } };
    if (p === '/v4/group-channel/message/send')
      res = { code: 0, result: { messageIds: (body.toChannelIds as string[]).map(c => ({ channelId: c, messageId: `MSG-${++msg}` })) } };
    if (p === '/v4/direct-channel/message/send')
      res = { code: 0, result: { messageIds: (body.toUserIds as string[]).map(u => ({ userId: u, messageId: `DM-${++msg}` })) } };
    if (p === '/v4/group-channel/join') res = { code: 0, result: { channelId: body.channelId, memberCount: 5 } };
    if (p === '/v4/group-channel/message/stream/send') {
      const content = body.content as { seq: number };
      res = { code: 0, result: content.seq === 1 ? { messageId: `STREAM-${++msg}` } : {} };
    }
    return { status: 200, text: async () => JSON.stringify(res) };
  };
  const now = { t: Date.now() };
  const nexconn =
    opts.nexconn === false
      ? null
      : opts.realNexconn
        ? new NexconnClient({ ...opts.realNexconn })
        : new NexconnClient({
            appKey: APP_KEY,
            appSecret: APP_SECRET,
            baseUrls: ['https://api.sg-light-api.com', 'https://api-b.sg-light-api.com'],
            fetch,
            sleep: async () => {},
          });
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://u:p@localhost:5432/test',
    WEB_ORIGIN: WEB,
    NEXCONN_APP_KEY: opts.realNexconn?.appKey ?? APP_KEY,
    NEXCONN_APP_SECRET: opts.realNexconn?.appSecret ?? APP_SECRET,
    TOKEN_ENCRYPTION_KEY: ENC_KEY,
    SESSION_SECRET: 'x'.repeat(40),
    ...opts.env,
  });
  const storage = createMemoryStorage();
  const clips = createMemoryStorage('clips');
  const uploads = createMemoryStorage('uploads');
  const tasks: Promise<void>[] = [];
  const ctxRef: { current: Ctx | null } = { current: null };
  const silent = { info: () => {}, warn: () => {}, error: () => {} };
  const queue = createMemoryQueue({ concurrency: 4, log: silent, delayMs: () => 0 });
  const agents = opts.agents
    ? (createAgentServices({
        config,
        nexconn,
        ai: opts.ai === undefined ? createFakeAiClient({ speed: 0 }) : opts.ai,
        ...(opts.playtester && { playtester: opts.playtester }),
        ...(opts.stt && { stt: opts.stt }),
        queue,
        ctxRef,
        log: silent,
      }) as AgentServices & {
        queue: typeof queue;
      })
    : null;
  const app = await buildApp({
    config,
    pingDb: async () => {},
    db,
    nexconn,
    agents,
    logger: false,
    storage,
    clips,
    uploads,
    now: () => now.t,
    runInBackground: (_name, task) => void tasks.push(task()),
    onReady: c => (ctxRef.current = c),
  });
  if (agents && ctxRef.current) {
    const c = ctxRef.current;
    await queue.start(job => handleAgentJob({ ...c, agents }, job));
    if (opts.builds) await queue.startBuilds(job => runBuildJob({ ...c, agents }, job));
    if (opts.playtester) await queue.startPlaytests(job => runGlitchJob({ ...c, agents }, job));
  }
  let eventNo = 0;
  return {
    app,
    db,
    pg,
    calls,
    storage,
    clips,
    uploads,
    failNext: (p, code) => void failures.set(p, code),
    flush: async () => {
      await Promise.all(tasks.splice(0));
    },
    close: async () => {
      agents?.states.stopAll();
      await app.close();
      await pg.close();
    },
    now,
    agents,
    settle: async () => {
      for (let i = 0; i < 5; i++) {
        await Promise.all(tasks.splice(0));
        await queue.idle();
        if (tasks.length === 0) break;
      }
    },
    webhook: (type, data, id) => {
      const nonce = `n${++eventNo}x`;
      const ts = String(now.t);
      return app.inject({
        method: 'POST',
        url: '/webhooks/nexconn',
        headers: { appkey: APP_KEY, nonce, timestamp: ts, signature: nexconnSignature(APP_SECRET, nonce, ts), 'content-type': 'application/json' },
        payload: { type, id: id ?? `evt-${eventNo}-${Math.random().toString(36).slice(2)}`, time: now.t, data },
      });
    },
    ctx: () => {
      if (!ctxRef.current) throw new Error('no ctx');
      return ctxRef.current;
    },
  };
}

/** "ca_session=..." from a Set-Cookie response header. */
export function sessionFrom(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const line = Array.isArray(raw) ? raw[0] : raw;
  if (!line) throw new Error('no set-cookie');
  return line.split(';')[0]!;
}

export async function signUp(h: Harness, name = 'Riya', ip = '10.0.0.1'): Promise<{ cookie: string; id: string }> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/auth/guest',
    headers: { origin: WEB },
    remoteAddress: ip,
    payload: { displayName: name, avatarEmoji: '🦊', avatarColor: 'pink' },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  return { cookie: sessionFrom(res), id: res.json().user.id };
}

/** A browser-free playtester: every scenario expect passes (or every one fails with pass=false). */
export function stubPlaytester(initial = true): Playtester & { runs: number; pass: boolean } {
  const me = {
    runs: 0,
    pass: initial,
    async playtest(input: Parameters<Playtester['playtest']>[0]) {
      if (!input.only) me.runs++;
      const pass = me.pass;
      const expects = (input.scenario ?? []).flatMap(s => ('expect' in s ? [{ label: s.label ?? s.expect, pass, scenario: 'scenario' }] : []));
      const checks = expects.map(e => ({ name: e.label, pass, detail: pass ? 'ok' : 'state {"x":0}', kind: 'scenario' as const }));
      const failed = checks.filter(c => !c.pass);
      return {
        pass: failed.length === 0,
        label: input.label ?? 'game',
        seed: 42,
        fps: 60,
        controls: ['ArrowLeft'],
        seconds: 1,
        checks,
        failed,
        expects,
        logs: [],
        screenshot: Buffer.from('png'),
        summary: '',
      };
    },
    clip: async () => Buffer.from('GIF89a'),
    clipBug: async () => Buffer.from('GIF89a'),
  };
  return me;
}

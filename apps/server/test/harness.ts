// Test harness: the real app on PGlite (real migrations + agent seed) with a fake Nexconn that
// records every Platform Chat API call and answers like the docs.
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
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
  /** Make the next call to `path` fail with this business code. */
  failNext: (path: string, code: number) => void;
  /** Await background work (webhook processing). */
  flush: () => Promise<void>;
  close: () => Promise<void>;
  now: { t: number };
}

export async function createHarness(opts: { nexconn?: boolean } = {}): Promise<Harness> {
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
    if (p === '/v4/group-channel/join') res = { code: 0, result: { channelId: body.channelId, memberCount: 5 } };
    return { status: 200, text: async () => JSON.stringify(res) };
  };
  const now = { t: Date.now() };
  const nexconn =
    opts.nexconn === false
      ? null
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
    NEXCONN_APP_KEY: APP_KEY,
    NEXCONN_APP_SECRET: APP_SECRET,
    TOKEN_ENCRYPTION_KEY: ENC_KEY,
    SESSION_SECRET: 'x'.repeat(40),
  });
  const tasks: Promise<void>[] = [];
  const app = await buildApp({
    config,
    pingDb: async () => {},
    db,
    nexconn,
    logger: false,
    now: () => now.t,
    runInBackground: (_name, task) => void tasks.push(task()),
  });
  return {
    app,
    db,
    pg,
    calls,
    failNext: (p, code) => void failures.set(p, code),
    flush: async () => {
      await Promise.all(tasks.splice(0));
    },
    close: async () => {
      await app.close();
      await pg.close();
    },
    now,
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

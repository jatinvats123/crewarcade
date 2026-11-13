// Builds the Fastify app. Dependencies are injected so tests run on PGlite with a fake Nexconn.
import Fastify, { type FastifyInstance } from 'fastify';
import { cookieSecure, sessionSecret, type Config } from './config';
import type { Ctx } from './context';
import type { Db } from './db/types';
import type { NexconnClient } from './nexconn/client';
import { registerAuthRoutes } from './routes/auth';
import type { AgentServices } from './agents/runtime-deps';
import { registerCrewRoutes } from './routes/crews';
import { registerGameRoutes } from './routes/games';
import { installApiPlumbing } from './routes/http';
import { registerWebhookRoutes } from './webhooks/routes';

export interface AppDeps {
  config: Config;
  /** Resolves when the database answers; rejects otherwise. */
  pingDb: () => Promise<void>;
  /** Without a db only /health and / are served (used by the health tests). */
  db?: Db;
  nexconn?: NexconnClient | null;
  agents?: AgentServices | null;
  /** Pino logger options override (tests pass false). */
  logger?: boolean | object;
  version?: string;
  now?: () => number;
  runInBackground?: Ctx['runInBackground'];
  /** Receives the request context once built (the entry point starts the agent worker with it). */
  onReady?: (ctx: Ctx) => void;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger:
      deps.logger ??
      (config.NODE_ENV === 'development'
        ? { level: config.LOG_LEVEL, transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
        : { level: config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.signature', 'req.headers.cookie', 'res.headers["set-cookie"]'] }),
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  const started = Date.now();

  app.get('/health', async (_req, reply) => {
    const t0 = performance.now();
    let db: 'up' | 'down' = 'up';
    let error: string | undefined;
    try {
      await withTimeout(deps.pingDb(), 3000);
    } catch (e) {
      db = 'down';
      error = (e as Error).message;
      app.log.warn({ err: e }, 'health: database ping failed');
    }
    const body = {
      ok: db === 'up',
      db,
      dbLatencyMs: Math.round(performance.now() - t0),
      uptimeS: Math.round((Date.now() - started) / 1000),
      version: deps.version ?? process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'dev',
      nexconn: deps.nexconn ? 'configured' : 'not_configured',
      ...(error && config.NODE_ENV !== 'production' && { error }),
    };
    return reply.code(db === 'up' ? 200 : 503).send(body);
  });

  app.get('/', async () => ({ name: 'crewarcade-server', health: '/health' }));

  if (deps.db) {
    const ctx: Ctx = {
      config,
      db: deps.db,
      nexconn: deps.nexconn ?? null,
      agents: deps.agents ?? null,
      log: app.log,
      session: { secret: sessionSecret(config), secure: cookieSecure(config), ...(deps.now && { now: deps.now }) },
      now: deps.now ?? Date.now,
      runInBackground:
        deps.runInBackground ??
        ((name, task) => {
          setImmediate(() => {
            task().catch(err => app.log.error({ err, task: name }, 'background task failed'));
          });
        }),
    };
    installApiPlumbing(app, ctx);
    registerAuthRoutes(app, ctx);
    registerCrewRoutes(app, ctx);
    registerGameRoutes(app, ctx);
    registerWebhookRoutes(app, ctx);
    deps.onReady?.(ctx);
  }
  return app;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      t = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

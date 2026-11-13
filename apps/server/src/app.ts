// Builds the Fastify app. Dependencies are injected so tests run without a database.
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config';

export interface AppDeps {
  config: Pick<Config, 'NODE_ENV' | 'LOG_LEVEL' | 'WEB_ORIGIN'>;
  /** Resolves when the database answers; rejects otherwise. */
  pingDb: () => Promise<void>;
  /** Pino logger options override (tests pass false). */
  logger?: boolean | object;
  version?: string;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger:
      deps.logger ??
      (config.NODE_ENV === 'development'
        ? { level: config.LOG_LEVEL, transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
        : { level: config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.signature', 'req.headers.cookie'] }),
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    disableRequestLogging: false,
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
      ...(error && config.NODE_ENV !== 'production' && { error }),
    };
    return reply.code(db === 'up' ? 200 : 503).send(body);
  });

  app.get('/', async () => ({ name: 'crewarcade-server', health: '/health' }));
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

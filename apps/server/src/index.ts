// Server entry: validate config (fail fast), connect to Postgres, make sure the agent users exist,
// wire Nexconn, start Fastify. One Render web service runs the API, webhooks, job workers and the
// playtest worker (later phases).
import type { FastifyBaseLogger } from 'fastify';
import { createAgentServices, createAi, createQueue, startAgentWorker } from './agents';
import { createClipStorage, createGameStorage, createUploadStorage } from './storage';
import { createHeadless } from './agents/smoke';
import { createSarvamStt } from './ai/sarvam';
import { purgeExpired } from './repo/retention';
import { buildApp } from './app';
import { ConfigError, integrations, loadConfig } from './config';
import type { Ctx } from './context';
import { createDb } from './db/client';
import { runMigrations } from './db/migrations';
import { seedAgents } from './db/seed-agents';
import { createNexconnClient } from './nexconn';

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(e instanceof ConfigError ? e.message : e);
  process.exit(1);
}

if (config.MIGRATE_ON_START) {
  try {
    await runMigrations(config.DATABASE_URL);
    console.log('Migrations applied (MIGRATE_ON_START)');
  } catch (e) {
    // Fail fast: a server on an unmigrated (or unreachable) database would only half work.
    // Drizzle wraps the driver error: print the cause too (code + message; never the URL).
    const cause = (e as { cause?: { code?: string; message?: string; errors?: Array<{ code?: string; address?: string; port?: number }> } }).cause;
    const parts = [
      e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e),
      cause?.code,
      cause?.message,
      ...(cause?.errors ?? []).map(x => `${x.code} ${x.address}:${x.port}`),
    ];
    console.error(
      'Migrations failed:',
      parts
        .filter(Boolean)
        .join(' | ')
        .replace(/postgres(ql)?:\/\/\S+/g, '[db url]'),
    );
    process.exit(1);
  }
}

const database = createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
// The Nexconn client logs through the app logger (paths, codes and timings; never bodies or tokens).
const logRef: { current?: FastifyBaseLogger } = {};
const nexconn = createNexconnClient(config, {
  debug: (o, m) => logRef.current?.debug(o, m),
  warn: (o, m) => logRef.current?.warn(o, m),
});
// Agents: Claude (or the fake client), pg-boss and live states. The logger exists only after
// buildApp, so the queue and AI log through the same late-bound reference.
const lateLog = {
  info: (o: object, m: string) => logRef.current?.info(o, m),
  warn: (o: object, m: string) => logRef.current?.warn(o, m),
  error: (o: object, m: string) => logRef.current?.error(o, m),
  debug: (o: object, m: string) => logRef.current?.debug(o, m),
};
const ctxRef: { current: Ctx | null } = { current: null };
const ai = createAi(config, lateLog);
const buildAi = createAi(config, lateLog, 'build');
const queue = createQueue(config, lateLog);
// One headless Chromium for Forge's smoke test and Glitch's playtests (launched on first use).
const headless = createHeadless();
const agents = createAgentServices({
  config,
  nexconn,
  ai,
  buildAi,
  ...(config.SARVAM_API_KEY && { stt: createSarvamStt({ apiKey: config.SARVAM_API_KEY }) }),
  ...(config.FORGE_SMOKE && { smoke: headless.smoke }),
  ...(config.PLAYTESTS && { playtester: headless.playtester }),
  queue,
  ctxRef,
  log: lateLog,
});
const storage = createGameStorage(config);
const clips = createClipStorage(config);
const uploads = createUploadStorage(config);
const server = await buildApp({ config, pingDb: database.ping, db: database.db, nexconn, agents, storage, clips, uploads, onReady: c => (ctxRef.current = c) });
await storage.ensureBucket().catch(e => server.log.error({ err: e }, 'could not check the games bucket'));
await clips.ensureBucket().catch(e => server.log.error({ err: e }, 'could not check the clips bucket'));
await uploads.ensureBucket().catch(e => server.log.error({ err: e }, 'could not check the uploads bucket'));
server.log.info({ storage: storage.kind, bucket: storage.bucket }, 'game storage ready');
logRef.current = server.log;
if (!ai) server.log.warn('ANTHROPIC_API_KEY not set and FAKE_AGENTS off: agents answer with an error message');
if (config.FAKE_AGENTS) server.log.warn('FAKE_AGENTS=1: agents use canned outputs (no Claude calls)');
server.log.info({ integrations: integrations(config) }, 'integrations configured');
if (!nexconn) server.log.warn('NEXCONN_APP_KEY / NEXCONN_APP_SECRET not set: chat routes answer 503');

try {
  await seedAgents(database.db, config.WEB_ORIGIN);
} catch (e) {
  server.log.error({ err: e }, 'could not upsert the agent users (is the database migrated?)');
}

// Retention: message logs and connection events older than 30 days (see repo/retention.ts).
const purge = () => purgeExpired(database.db, Date.now()).catch(e => server.log.error({ err: e }, 'retention purge failed'));
void purge();
setInterval(() => void purge(), 6 * 3_600_000).unref();

if (config.RUN_WORKERS && ctxRef.current)
  await startAgentWorker(ctxRef.current).catch(e => server.log.error({ err: e }, 'agent worker failed to start (is the job database reachable?)'));

const shutdown = async (signal: string) => {
  server.log.info({ signal }, 'shutting down');
  agents.states.stopAll();
  await queue.stop().catch(() => {});
  await headless.close();
  await server.close().catch(() => {});
  await database.close().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await server.listen({ port: config.PORT, host: config.HOST });
  server.log.info(`Nexconn webhook URL: ${config.PUBLIC_API_ORIGIN.replace(/\/+$/, '')}/webhooks/nexconn`);
} catch (e) {
  server.log.error(e, 'failed to start');
  process.exit(1);
}

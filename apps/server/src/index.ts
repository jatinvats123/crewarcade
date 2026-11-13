// Server entry: validate config (fail fast), connect to Postgres, make sure the agent users exist,
// wire Nexconn, start Fastify. One Render web service runs the API, webhooks, job workers and the
// playtest worker (later phases).
import type { FastifyBaseLogger } from 'fastify';
import { buildApp } from './app';
import { ConfigError, integrations, loadConfig } from './config';
import { createDb } from './db/client';
import { seedAgents } from './db/seed-agents';
import { createNexconnClient } from './nexconn';

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(e instanceof ConfigError ? e.message : e);
  process.exit(1);
}

const database = createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
// The Nexconn client logs through the app logger (paths, codes and timings; never bodies or tokens).
const logRef: { current?: FastifyBaseLogger } = {};
const nexconn = createNexconnClient(config, {
  debug: (o, m) => logRef.current?.debug(o, m),
  warn: (o, m) => logRef.current?.warn(o, m),
});
const server = await buildApp({ config, pingDb: database.ping, db: database.db, nexconn });
logRef.current = server.log;
server.log.info({ integrations: integrations(config) }, 'integrations configured');
if (!nexconn) server.log.warn('NEXCONN_APP_KEY / NEXCONN_APP_SECRET not set: chat routes answer 503');

try {
  await seedAgents(database.db, config.WEB_ORIGIN);
} catch (e) {
  server.log.error({ err: e }, 'could not upsert the agent users (is the database migrated?)');
}

const shutdown = async (signal: string) => {
  server.log.info({ signal }, 'shutting down');
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

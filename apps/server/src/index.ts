// Server entry: validate config (fail fast), connect to Postgres, start Fastify.
// One Render web service runs the API, webhooks, job workers and the playtest worker (later phases).
import { buildApp } from './app';
import { ConfigError, integrations, loadConfig } from './config';
import { createDb } from './db/client';

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(e instanceof ConfigError ? e.message : e);
  process.exit(1);
}

const database = createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
const app = await buildApp({ config, pingDb: database.ping });
app.log.info({ integrations: integrations(config) }, 'integrations configured');

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close().catch(() => {});
  await database.close().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (e) {
  app.log.error(e, 'failed to start');
  process.exit(1);
}

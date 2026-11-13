// pnpm --filter @crewarcade/server db:seed
// Idempotent: upserts the three agent users (agent-pixel, agent-forge, agent-glitch).
import { loadDbScriptConfig } from '../config';
import { createDb } from './client';
import { seedAgents } from './seed-agents';

const config = loadDbScriptConfig();
const { db, close } = createDb(config.DATABASE_URL, { max: 1 });
try {
  const ids = await seedAgents(db, config.WEB_ORIGIN);
  console.log(`Seeded ${ids.length} agent users: ${ids.join(', ')}`);
} finally {
  await close();
}

// pnpm --filter @crewarcade/server db:seed
// Idempotent: upserts the three agent users (agent-pixel, agent-forge, agent-glitch).
import { sql } from 'drizzle-orm';
import { loadConfig } from '../config';
import { agentUserRows } from './agents';
import { createDb } from './client';
import { users } from './schema';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL, { max: 1 });
try {
  const rows = agentUserRows(config.WEB_ORIGIN);
  await db
    .insert(users)
    .values(rows)
    .onConflictDoUpdate({
      target: users.id,
      set: {
        displayName: sql`excluded.display_name`,
        avatarEmoji: sql`excluded.avatar_emoji`,
        avatarColor: sql`excluded.avatar_color`,
        avatarUrl: sql`excluded.avatar_url`,
        isAgent: sql`true`,
      },
    });
  console.log(`Seeded ${rows.length} agent users: ${rows.map(r => r.id).join(', ')}`);
} finally {
  await close();
}

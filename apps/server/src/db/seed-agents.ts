// Upserts the three agent users. Works with any Drizzle Postgres driver (postgres.js in the app,
// PGlite in tests), so the seed that runs in production is the seed that is tested.
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { agentUserRows } from './agents';
import { users } from './schema';

export async function seedAgents<T extends PgQueryResultHKT>(db: PgDatabase<T, Record<string, unknown>>, webOrigin: string): Promise<string[]> {
  const rows = agentUserRows(webOrigin);
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
  return rows.map(r => r.id);
}

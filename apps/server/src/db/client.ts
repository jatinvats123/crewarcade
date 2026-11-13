// Postgres client (postgres.js) + Drizzle. Server only.
// prepare: false keeps it compatible with Supabase's transaction pooler (port 6543).
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from './schema';

export function createDb(url: string, { max = 10 }: { max?: number } = {}) {
  const sql = postgres(url, { max, prepare: false, idle_timeout: 20, connect_timeout: 10 });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return {
    db,
    sql,
    /** Cheap liveness probe used by /health. */
    ping: async () => {
      await sql`select 1`;
    },
    close: () => sql.end({ timeout: 5 }),
  };
}

export type Database = ReturnType<typeof createDb>['db'];

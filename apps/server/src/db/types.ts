// Driver-agnostic Drizzle database type: postgres.js in the app, PGlite in tests.
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { schema } from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

import { defineConfig } from 'drizzle-kit';

// `db:generate` only reads the schema; `db:migrate` uses src/db/migrate.ts with DATABASE_URL.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/crewarcade' },
  strict: true,
  verbose: true,
});

// MIGRATE_ON_START (Render free plan): the server finds drizzle/ from src/db (tsx) and from dist/ (bundled).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { findMigrationsFolder } from '../src/db/migrations';

const root = path.resolve(__dirname, '..');

describe('migrations on start', () => {
  it('finds the migrations folder from src/db and from dist', () => {
    expect(findMigrationsFolder(path.join(root, 'src', 'db'))).toBe(path.join(root, 'drizzle'));
    expect(findMigrationsFolder(path.join(root, 'dist'))).toBe(path.join(root, 'drizzle'));
    expect(() => findMigrationsFolder(path.parse(root).root)).toThrow(/not found/);
  });
  it('is off unless MIGRATE_ON_START=true', () => {
    const base = { NODE_ENV: 'test', DATABASE_URL: 'postgres://u:p@localhost:5432/t' };
    expect(loadConfig(base).MIGRATE_ON_START).toBe(false);
    expect(loadConfig({ ...base, MIGRATE_ON_START: 'true' }).MIGRATE_ON_START).toBe(true);
  });
});

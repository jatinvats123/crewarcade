// Applies the real migrations to a real Postgres engine (PGlite, in-process WASM) and runs the seed,
// so every migration is checked in CI without a database server.
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, users, crews, crewMembers, games, ledger } from '../src/db/schema';
import { seedAgents } from '../src/db/seed-agents';

const client = new PGlite();
const db = drizzle(client, { schema, casing: 'snake_case' });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, '..', 'drizzle') });
}, 60_000);
afterAll(async () => {
  await client.close();
});

describe('migrations + seed on Postgres', () => {
  it('creates every table', async () => {
    const res = await client.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' order by 1`);
    expect(res.rows.map(r => r.table_name)).toEqual([
      'bugs',
      'cards',
      'connections',
      'crew_members',
      'crews',
      'game_versions',
      'games',
      'ledger',
      'live_rooms',
      'messages_log',
      'moderation_log',
      'scores',
      'usage',
      'users',
      'webhook_events',
    ]);
  });

  it('seeds the three agents idempotently', async () => {
    await seedAgents(db, 'http://localhost:3000');
    await seedAgents(db, 'https://crewarcade.example');
    const rows = await db.select().from(users).where(eq(users.isAgent, true)).orderBy(users.id);
    expect(rows.map(r => [r.id, r.displayName])).toEqual([
      ['agent-forge', 'Forge · Builder'],
      ['agent-glitch', 'Glitch · Playtester'],
      ['agent-pixel', 'Pixel · Designer'],
    ]);
    expect(rows[0]!.avatarUrl).toBe('https://crewarcade.example/agents/forge.svg');
  });

  it('enforces enum-like CHECK constraints, unique invite codes and slugs', async () => {
    await db.insert(users).values({ id: 'u1', displayName: 'Asha' });
    await db.insert(crews).values({ id: 'c1', groupChannelId: 'crew1', name: 'Friday', ownerId: 'u1', inviteCode: 'K7XQ2MPA' });
    await expect(db.insert(crewMembers).values({ crewId: 'c1', userId: 'u1', role: 'boss' as 'owner' })).rejects.toThrow();
    await expect(db.insert(crews).values({ id: 'c2', groupChannelId: 'crew2', name: 'Dup', ownerId: 'u1', inviteCode: 'K7XQ2MPA' })).rejects.toThrow();
    await expect(db.insert(games).values({ id: 'g1', slug: 'Bad Slug', crewId: 'c1', title: 'x', pitch: 'y', createdBy: 'u1' })).rejects.toThrow();
    await db.insert(games).values({ id: 'g2', slug: 'moon-mango', crewId: 'c1', title: 'Moon Mango', pitch: 'p', createdBy: 'u1' });
    await expect(db.insert(ledger).values({ id: 'l1', actorType: 'agent', actorId: 'agent-pixel', action: 'Not An Action', summary: 's' })).rejects.toThrow();
    await db.insert(ledger).values({ id: 'l2', gameId: 'g2', actorType: 'agent', actorId: 'agent-pixel', action: 'plan.created', summary: 'Plan posted' });
    const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from ledger`);
    expect(rows[0]?.n).toBe(1);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_IDS } from '@crewarcade/shared';
import { buildApp } from '../src/app';
import { ConfigError, integrations, loadConfig, loadDbScriptConfig } from '../src/config';
import { agentUserRows } from '../src/db/agents';
import { schema } from '../src/db/schema';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const DB = 'postgres://user:pass@localhost:5432/crewarcade';

describe('config', () => {
  it('applies defaults in development', () => {
    const c = loadConfig({ DATABASE_URL: DB });
    expect(c).toMatchObject({
      NODE_ENV: 'development',
      PORT: 8080,
      NEXCONN_API_BASE: 'https://api.sg-light-api.com',
      NEXCONN_API_BACKUP: 'https://api-b.sg-light-api.com',
      ANTHROPIC_MODEL: 'claude-opus-5-5',
      RUN_WORKERS: true,
    });
    expect(integrations(c)).toEqual({
      nexconn: false,
      supabaseStorage: false,
      anthropic: false,
      gemini: false,
      fakeAgents: false,
      sarvam: false,
      tokenEncryption: false,
      sessionSecret: false,
    });
    expect(c).toMatchObject({ AGENT_CONCURRENCY: 4, FAKE_AGENTS: false, AI_TIMEOUT_MS: 120_000 });
  });

  it('production needs ANTHROPIC_API_KEY unless FAKE_AGENTS is on', () => {
    const prod = {
      NODE_ENV: 'production',
      DATABASE_URL: DB,
      NEXCONN_APP_KEY: 'k',
      NEXCONN_APP_SECRET: 's',
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'r',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
      SESSION_SECRET: 'x'.repeat(40),
    };
    expect(() => loadConfig(prod)).toThrow(/ANTHROPIC_API_KEY/);
    expect(loadConfig({ ...prod, FAKE_AGENTS: '1' }).FAKE_AGENTS).toBe(true);
  });

  it('fails fast listing every missing value', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({ NODE_ENV: 'production', DATABASE_URL: DB });
    } catch (e) {
      const problems = (e as ConfigError).problems.join('\n');
      for (const k of [
        'NEXCONN_APP_KEY',
        'NEXCONN_APP_SECRET',
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'ANTHROPIC_API_KEY',
        'TOKEN_ENCRYPTION_KEY',
        'SESSION_SECRET',
      ])
        expect(problems).toContain(k);
      return;
    }
    throw new Error('expected a ConfigError');
  });

  it('treats empty switches from a copied .env.example as unset', () => {
    const c = loadConfig({ DATABASE_URL: DB, COOKIE_SECURE: '', FAKE_AGENTS: '', RUN_WORKERS: '' });
    expect(c.COOKIE_SECURE).toBeUndefined();
    expect(c).toMatchObject({ FAKE_AGENTS: false, RUN_WORKERS: true });
  });

  it('rejects malformed values', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x' })).toThrow(/postgres/);
    expect(() => loadConfig({ DATABASE_URL: DB, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ DATABASE_URL: DB, TOKEN_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(/32 bytes/);
  });

  it('accepts a complete production config', () => {
    const c = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: DB,
      NEXCONN_APP_KEY: 'k',
      NEXCONN_APP_SECRET: 's',
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'svc',
      ANTHROPIC_API_KEY: 'a',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      SESSION_SECRET: 's'.repeat(32),
    });
    expect(integrations(c).nexconn).toBe(true);
  });
});

describe('db script config', () => {
  it('needs only the database in production (migrate/seed run before the app keys matter)', () => {
    expect(loadDbScriptConfig({ NODE_ENV: 'production', DATABASE_URL: DB })).toEqual({ DATABASE_URL: DB, WEB_ORIGIN: 'http://localhost:3000' });
    expect(() => loadDbScriptConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });
});

describe('/health', () => {
  const config = loadConfig({ DATABASE_URL: DB, NODE_ENV: 'test' });
  it('is 200 when the database answers', async () => {
    const app = await buildApp({ config, pingDb: async () => {}, logger: false, version: 'test' });
    const res = await app.inject('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, db: 'up', version: 'test' });
    await app.close();
  });
  it('is 503 when the database is down or slow', async () => {
    const down = await buildApp({ config, pingDb: async () => Promise.reject(new Error('ECONNREFUSED')), logger: false });
    const res = await down.inject('/health');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, db: 'down', error: 'ECONNREFUSED' });
    await down.close();
  });
});

describe('data model', () => {
  it('has every table from the spec', () => {
    expect(Object.keys(schema).sort()).toEqual(
      [
        'bugs',
        'cards',
        'connections',
        'crewMembers',
        'crews',
        'gameVersions',
        'games',
        'ledger',
        'liveRooms',
        'messagesLog',
        'moderationLog',
        'scores',
        'usage',
        'users',
        'webhookEvents',
      ].sort(),
    );
  });
  it('ships a migration that creates every table', () => {
    const dir = path.join(ROOT, 'apps', 'server', 'drizzle');
    const sql = fs
      .readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
    for (const t of [
      'users',
      'crews',
      'crew_members',
      'games',
      'game_versions',
      'bugs',
      'scores',
      'cards',
      'ledger',
      'messages_log',
      'moderation_log',
      'connections',
      'usage',
      'live_rooms',
      'webhook_events',
    ])
      expect(sql).toContain(`CREATE TABLE "${t}"`);
    expect(sql).toMatch(/scores_game_score_idx.*"score" DESC/s);
  });
  it('seeds the three agents with avatars served by the web app', () => {
    const rows = agentUserRows('https://crewarcade.app/');
    expect(rows.map(r => r.id)).toEqual(Object.values(AGENT_IDS));
    expect(rows.map(r => r.displayName)).toEqual(['Pixel · Designer', 'Forge · Builder', 'Glitch · Playtester']);
    expect(rows.every(r => r.isAgent)).toBe(true);
    expect(rows[0]!.avatarUrl).toBe('https://crewarcade.app/agents/pixel.svg');
    for (const r of rows) expect(fs.existsSync(path.join(ROOT, 'apps', 'web', 'public', new URL(r.avatarUrl!).pathname))).toBe(true);
  });
});

describe('deploy', () => {
  it('pins the Playwright Docker image to the engine Playwright version', () => {
    const engine = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'engine', 'package.json'), 'utf8'));
    const server = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'server', 'package.json'), 'utf8'));
    const docker = fs.readFileSync(path.join(ROOT, 'apps', 'server', 'Dockerfile'), 'utf8');
    const v = engine.dependencies.playwright;
    expect(server.dependencies.playwright).toBe(v);
    expect(docker).toContain(`mcr.microsoft.com/playwright:v${v}-noble`);
    // The Playwright image ships a newer Node; the image must run Node 22 LTS.
    expect(docker).toMatch(/FROM node:22\.\d+\.\d+-bookworm-slim AS node22/);
  });
});

describe('bundle dependencies', () => {
  it('declares every runtime dependency of the workspace packages esbuild bundles in (pnpm is strict)', () => {
    const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    const server = Object.keys(read('apps/server').dependencies ?? {});
    for (const pkg of ['packages/shared']) for (const dep of Object.keys(read(pkg).dependencies ?? {})) expect(server, `${pkg} needs ${dep}`).toContain(dep);
  });
});

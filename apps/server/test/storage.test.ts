import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assertKey, createGameStorage, createLocalStorage, createSupabaseStorage, gameHtmlKey, StorageError } from '../src/storage';

describe('game storage', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  it('keys games as <slug>/v<N>/index.html and refuses traversal', () => {
    expect(gameHtmlKey('chai-dash', 3)).toBe('chai-dash/v3/index.html');
    expect(() => assertKey('chai-dash/v1/index.html')).not.toThrow();
    for (const bad of ['../etc/passwd', 'a/../../x', 'chai-dash/v1/..', '/abs/x', 'UP/x', 'a b/x']) expect(() => assertKey(bad)).toThrow();
  });

  it('local disk round-trips and returns null for missing objects', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ca-store-'));
    dirs.push(dir);
    const s = createLocalStorage({ dir, bucket: 'games' });
    expect(await s.put(gameHtmlKey('chai-dash', 1), '<html>हि</html>', 'text/html')).toBe('games/chai-dash/v1/index.html');
    expect((await s.get('chai-dash/v1/index.html'))?.toString('utf8')).toBe('<html>हि</html>');
    expect(await s.get('chai-dash/v2/index.html')).toBeNull();
  });

  it('production never falls back to the local disk', () => {
    const base = { SUPABASE_GAMES_BUCKET: 'games', GAMES_LOCAL_DIR: '.data/games' } as const;
    expect(() => createGameStorage({ ...base, NODE_ENV: 'production', SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined })).toThrow(StorageError);
    expect(createGameStorage({ ...base, NODE_ENV: 'development', SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }).kind).toBe('local');
    expect(createGameStorage({ ...base, NODE_ENV: 'production', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' }).kind).toBe(
      'supabase',
    );
  });

  it('talks to the Supabase Storage REST API with the service key (upsert, authenticated read, private bucket)', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }> = [];
    const store = new Map<string, Buffer>();
    const s = createSupabaseStorage({
      url: 'https://x.supabase.co/',
      serviceKey: 'svc',
      bucket: 'games',
      fetch: async (url, init) => {
        calls.push({ url, method: init.method, headers: init.headers, body: init.body });
        const key = url.split('/games/')[1] ?? '';
        if (init.method === 'POST' && url.includes('/object/')) store.set(key, Buffer.from(init.body as Buffer));
        const hit = init.method === 'GET' ? store.get(key) : undefined;
        const status = init.method === 'GET' && !hit ? 400 : 200;
        return { status, arrayBuffer: async () => (hit ?? Buffer.alloc(0)).buffer.slice(0) as ArrayBuffer, text: async () => '' };
      },
    });
    await s.ensureBucket();
    await s.put('chai-dash/v1/index.html', '<html></html>', 'text/html; charset=utf-8');
    expect(await s.get('chai-dash/v2/index.html')).toBeNull();
    expect(calls[0]).toMatchObject({ url: 'https://x.supabase.co/storage/v1/bucket', method: 'POST' });
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ id: 'games', name: 'games', public: false });
    expect(calls[1]).toMatchObject({
      url: 'https://x.supabase.co/storage/v1/object/games/chai-dash/v1/index.html',
      headers: { Authorization: 'Bearer svc', apikey: 'svc', 'x-upsert': 'true' },
    });
    expect(calls[2]!.url).toBe('https://x.supabase.co/storage/v1/object/authenticated/games/chai-dash/v2/index.html');
  });
});

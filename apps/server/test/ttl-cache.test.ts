// The TTL cache behind hot-path lookups (member counts, shield roles).
import { describe, expect, it } from 'vitest';
import { createTtlCache } from '../src/util/ttl-cache';

describe('ttl cache', () => {
  it('serves cached values until they expire, shares concurrent loads, never caches failures', async () => {
    let t = 0;
    let loads = 0;
    const c = createTtlCache<number>({ ttlMs: 1000, now: () => t });
    const load = async () => ++loads;
    const [a, b] = await Promise.all([c.get('k', load), c.get('k', load)]);
    expect([a, b, loads]).toEqual([1, 1, 1]);
    t = 999;
    expect(await c.get('k', load)).toBe(1);
    t = 1000;
    expect(await c.get('k', load)).toBe(2);
    await expect(c.get('bad', () => Promise.reject(new Error('db down')))).rejects.toThrow('db down');
    expect(await c.get('bad', async () => 7)).toBe(7);
    c.delete('k');
    expect(await c.get('k', load)).toBe(3);
  });
  it('drops the oldest entries past max', async () => {
    const c = createTtlCache<string>({ ttlMs: 60_000, max: 2 });
    await c.get('a', async () => 'a');
    await c.get('b', async () => 'b');
    await c.get('c', async () => 'c');
    expect(c.size).toBe(2);
  });
});

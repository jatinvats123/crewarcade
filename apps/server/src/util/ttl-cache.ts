// A tiny in-memory TTL cache for hot read paths (crew/member lookups per chat message). One server
// process; entries expire after `ttlMs` and the oldest go first past `max`. Concurrent misses for the
// same key share one load. Clock injected for tests.
export interface TtlCache<V> {
  get(key: string, load: () => Promise<V>): Promise<V>;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

export function createTtlCache<V>(o: { ttlMs: number; max?: number; now?: () => number }): TtlCache<V> {
  const now = o.now ?? Date.now;
  const max = o.max ?? 2000;
  const map = new Map<string, { at: number; value: Promise<V> }>();
  return {
    get(key, load) {
      const hit = map.get(key);
      if (hit && now() - hit.at < o.ttlMs) return hit.value;
      const value = load();
      map.set(key, { at: now(), value });
      // A failed load is not cached.
      value.catch(() => {
        if (map.get(key)?.value === value) map.delete(key);
      });
      while (map.size > max) map.delete(map.keys().next().value!);
      return value;
    },
    delete: key => void map.delete(key),
    clear: () => map.clear(),
    get size() {
      return map.size;
    },
  };
}

import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { scan } from './check-client-secrets.mjs';

const files = (map: Record<string, string>) => ({ list: Object.keys(map), read: (f: string) => map[f]! });

describe('check-client-secrets', () => {
  it('passes clean client code', () => {
    const { list, read } = files({ '/r/apps/web/a.ts': 'const k = process.env.NEXT_PUBLIC_NEXCONN_APP_KEY;' });
    expect(scan(list, read)).toEqual([]);
  });
  it('fails on server secret names in client code', () => {
    const { list, read } = files({
      '/r/apps/web/a.ts': 'fetch(x, { headers: { k: process.env.ANTHROPIC_API_KEY } })',
      '/r/apps/web/b.ts': 'NEXCONN_APP_SECRET',
    });
    const problems = scan(list, read);
    expect(problems.join('\n')).toMatch(/ANTHROPIC_API_KEY/);
    expect(problems.join('\n')).toMatch(/NEXCONN_APP_SECRET/);
  });
  it('fails on secret-looking NEXT_PUBLIC_ variables', () => {
    const { list, read } = files({ '/r/apps/web/.env.example': 'NEXT_PUBLIC_NEXCONN_SECRET=\nNEXT_PUBLIC_SUPABASE_SERVICE_ROLE=' });
    expect(scan(list, read)).toHaveLength(2);
  });
});

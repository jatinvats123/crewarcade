// The free server sleeps: 502/503/504 from the proxy mean "wait for it", the API client pings until
// it answers, retries the request once, and a page's concurrent calls share one wait.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';
import { isWakeStatus, onWaking, pollUntilAwake, waitForServer } from '../src/lib/wake';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const instant = { sleep: async () => {}, intervalMs: 0 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('wake rules', () => {
  it('only proxy errors count as "asleep"', () => {
    expect([502, 503, 504].every(isWakeStatus)).toBe(true);
    expect([200, 401, 404, 409, 429, 500].some(isWakeStatus)).toBe(false);
  });

  it('pings until any non-wake answer (a 401 means awake), or gives up', async () => {
    const answers = [502, 0, 504, 401];
    const ping = vi.fn(async () => answers.shift()!);
    expect(await pollUntilAwake({ ping, ...instant })).toBe(true);
    expect(ping).toHaveBeenCalledTimes(4);
    let t = 0;
    expect(await pollUntilAwake({ ping: async () => 502, timeoutMs: 10, now: () => (t += 4), ...instant })).toBe(false);
  });

  it('concurrent callers share one wait, and the banner state turns on then off', async () => {
    const states: boolean[] = [];
    const off = onWaking(w => states.push(w));
    let release!: () => void;
    const gate = new Promise<number>(r => (release = () => r(401)));
    const ping = vi.fn(() => gate);
    const a = waitForServer({ ping, ...instant });
    const b = waitForServer({ ping, ...instant });
    release();
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(ping).toHaveBeenCalledTimes(1);
    expect(states).toEqual([true, false]);
    off();
  });
});

describe('API client retry', () => {
  it('a 502 while asleep: waits, then retries the request once and succeeds', async () => {
    const user = {
      id: 'u1',
      nexconnId: 'u1',
      displayName: 'Asha',
      avatarEmoji: '🦊',
      avatarColor: 'pink',
      avatarUrl: null,
      language: 'en',
      isAgent: false,
      isJudge: false,
    };
    const calls: string[] = [];
    let signUps = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url === '/api/me') return json(401, { error: 'unauthorized', message: 'Sign in first' });
        return ++signUps === 1 ? json(502, {}) : json(201, { user });
      }),
    );
    const res = await api.signUp({ displayName: 'Asha', avatarEmoji: '🦊', avatarColor: 'pink' });
    expect(calls).toEqual(['POST /api/auth/guest', 'GET /api/me', 'POST /api/auth/guest']);
    expect(res.displayName).toBe('Asha');
  });

  it('a real error (e.g. 409) is never retried', async () => {
    const fetchMock = vi.fn(async () => json(409, { error: 'conflict', message: 'Already decided' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.publish('m1', 'allow')).rejects.toMatchObject({ status: 409, message: 'Already decided' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

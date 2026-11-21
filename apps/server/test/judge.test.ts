// Judge mode (/try): one-tap sign-up, marked as a judge, never counted as a real user, rate limited.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema';
import { createHarness, sessionFrom, WEB, type Harness } from './harness';

describe('POST /api/auth/judge', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  }, 60_000);
  afterAll(() => h.close());

  const judge = (ip = '10.9.0.1', payload: object = {}) =>
    h.app.inject({ method: 'POST', url: '/api/auth/judge', headers: { origin: WEB }, remoteAddress: ip, payload });

  it('signs a judge in with one tap: no form, a session, and the account marked as a judge', async () => {
    const res = await judge('10.9.0.1', { language: 'hi' });
    expect(res.statusCode).toBe(201);
    const { user } = res.json();
    expect(user.displayName).toBe('Judge');
    const [row] = await h.db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({ isJudge: true, referrer: 'judge', language: 'hi', isAgent: false });
    const me = await h.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: sessionFrom(res) } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(user.id);
    // The web app shows the judge tour from this flag only.
    expect(user.isJudge).toBe(true);
    expect(me.json().user.isJudge).toBe(true);
  });

  it('ordinary guests are never judges (no tour for them)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/auth/guest',
      headers: { origin: WEB },
      remoteAddress: '10.9.0.9',
      payload: { displayName: 'Asha', avatarEmoji: '🦊', avatarColor: 'violet' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.isJudge).toBe(false);
    const me = await h.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: sessionFrom(res) } });
    expect(me.json().user.isJudge).toBe(false);
  });

  it('works with an empty body and defaults to English', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/api/auth/judge', headers: { origin: WEB }, remoteAddress: '10.9.0.2' });
    expect(res.statusCode).toBe(201);
    const [row] = await h.db.select().from(users).where(eq(users.id, res.json().user.id));
    expect(row?.language).toBe('en');
  });

  it('judges are never counted as real people on /impact', async () => {
    const impact = (await h.app.inject({ method: 'GET', url: '/api/public/impact' })).json();
    expect(impact.people.signedUp).toBe(1); // the guest above
    expect(impact.excluded.judgeAccounts).toBe(2);
  });

  it('shares the sign-up rate limit (10 a minute per IP)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await judge('10.9.0.3')).statusCode);
    expect(codes.slice(0, 10).every(c => c === 201)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

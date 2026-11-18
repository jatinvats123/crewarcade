// /admin is owner-only (ADMIN_USER_IDS) and counts signups by referrer (?ref= on links).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, signUp, WEB, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ nexconn: false });
});
afterAll(async () => h.app.close());

const guest = (name: string, referrer: unknown, ip: string) =>
  h.app.inject({ method: 'POST', url: '/api/auth/guest', headers: { origin: WEB }, remoteAddress: ip, payload: { displayName: name, avatarEmoji: '🦊', avatarColor: 'pink', referrer } });

describe('/api/admin/stats', () => {
  it('stores a valid referrer, drops a bad one without failing sign-up', async () => {
    expect((await guest('Wa', 'WA', '10.1.0.1')).statusCode).toBe(201);
    expect((await guest('Bad', '<script>', '10.1.0.2')).statusCode).toBe(201);
    expect((await guest('Long', 'x'.repeat(80), '10.1.0.3')).statusCode).toBe(201);
  });

  it('is a 404 for guests and signed-in non-admins; admins get the stats', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/admin/stats' })).statusCode).toBe(404);
    const someone = await signUp(h, 'Someone', '10.1.0.4');
    expect((await h.app.inject({ method: 'GET', url: '/api/admin/stats', headers: { cookie: someone.cookie } })).statusCode).toBe(404);

    const owner = await signUp(h, 'Owner', '10.1.0.5');
    h.ctx().config.ADMIN_USER_IDS.push(owner.id);
    const res = await h.app.inject({ method: 'GET', url: '/api/admin/stats', headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stages.map((s: { stage: string }) => s.stage)).toEqual(['plan', 'build', 'test']);
    expect(body.signups.byReferrer).toEqual(expect.arrayContaining([{ referrer: 'wa', users: 1 }, { referrer: 'direct', users: 4 }]));
    expect(body.signups.total).toBe(5);
  });
});

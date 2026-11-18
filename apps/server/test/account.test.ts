// "Delete my account": crews pass on or go, the user's rows go, other people's games keep working.
import { nexconnUserId } from '@crewarcade/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bugs, connections, crewMembers, crews, games, messagesLog, scores, users } from '../src/db/schema';
import { purgeExpired } from '../src/repo/retention';
import { DELETED_USER_ID } from '../src/services/account';
import { createHarness, signUp, WEB, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.app.close());

const post = (url: string, cookie: string, payload?: unknown) => h.app.inject({ method: 'POST', url, headers: { cookie, origin: WEB }, payload: payload ?? {} });
const del = (cookie: string, payload?: unknown, origin = WEB) => h.app.inject({ method: 'DELETE', url: '/api/me', headers: { cookie, origin }, payload: payload ?? {} });

describe('retention', () => {
  it('purges message logs and connection events older than 30 days, keeps newer ones', async () => {
    const now = Date.now();
    const old = new Date(now - 31 * 86_400_000);
    await h.db.insert(messagesLog).values([
      { nexconnMessageId: 'old1', channelId: 'c', channelType: 3, fromUserId: 'u', messageType: 'text', text: 'old', createdAt: old },
      { nexconnMessageId: 'new1', channelId: 'c', channelType: 3, fromUserId: 'u', messageType: 'text', text: 'new' },
    ]);
    await h.db.insert(connections).values([
      { eventId: 'e-old', userId: 'u', status: '0', at: old },
      { eventId: 'e-new', userId: 'u', status: '0', at: new Date(now) },
    ]);
    await purgeExpired(h.db, now);
    expect((await h.db.select().from(messagesLog)).map(r => r.nexconnMessageId)).toEqual(['new1']);
    expect((await h.db.select().from(connections)).map(r => r.eventId)).toEqual(['e-new']);
    await h.db.delete(messagesLog);
  });
});

describe('DELETE /api/me', () => {
  it('needs the explicit confirmation, a same-origin request and a session', async () => {
    const u = await signUp(h, 'Kabir', '10.2.0.9');
    expect((await del(u.cookie)).statusCode).toBe(400);
    expect((await del(u.cookie, { confirm: 'delete my account' }, 'https://evil.example')).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'DELETE', url: '/api/me', headers: { origin: WEB }, payload: { confirm: 'delete my account' } })).statusCode).toBe(401);
  });

  it('hands shared crews on, deletes solo crews, credits kept rows to "Deleted player" and removes personal rows', async () => {
    const asha = await signUp(h, 'Asha', '10.2.0.1');
    const riya = await signUp(h, 'Riya', '10.2.0.2');
    const shared = (await post('/api/crews', asha.cookie, { name: 'Shared crew' })).json().crew;
    const solo = (await post('/api/crews', asha.cookie, { name: 'Solo crew' })).json().crew;
    expect((await post(`/api/invites/${shared.inviteCode}/join`, riya.cookie)).statusCode).toBe(200);

    // A game Asha started in the shared crew, her bug report with a screenshot, a score and a chat log row.
    await h.db.insert(games).values({ id: 'gAshaGame', slug: 'asha-game', crewId: shared.id, title: 'Asha Game', pitch: 'p', createdBy: asha.id });
    await h.db.insert(games).values({ id: 'gSoloGame', slug: 'solo-game', crewId: solo.id, title: 'Solo', pitch: 'p', createdBy: asha.id });
    await h.ctx().uploads.put('asha-game/bugs/b1.png', Buffer.from('png'), 'image/png');
    await h.db.insert(bugs).values({ id: 'b1', gameId: 'gAshaGame', reporterId: asha.id, description: 'stuck', screenshotPath: 'asha-game/bugs/b1.png' });
    await h.db.insert(scores).values({ id: 's1', gameId: 'gAshaGame', version: 1, userId: asha.id, score: 5, timeMs: 5000 });
    await h.db.insert(messagesLog).values({ nexconnMessageId: 'm1', channelId: shared.groupChannelId, channelType: 3, fromUserId: nexconnUserId(asha.id), messageType: 'text', text: 'hi' });

    const before = h.calls.length;
    const res = await del(asha.cookie, { confirm: 'delete my account' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true, crewsTransferred: 1, crewsDeleted: 1 });
    expect(String(res.headers['set-cookie'])).toMatch(/ca_session=;/);

    expect(await h.db.select().from(users).where(eq(users.id, asha.id))).toEqual([]);
    const [crewRow] = await h.db.select().from(crews).where(eq(crews.id, shared.id));
    expect(crewRow!.ownerId).toBe(riya.id);
    expect((await h.db.select().from(crewMembers).where(eq(crewMembers.userId, riya.id)))[0]!.role).toBe('owner');
    expect(await h.db.select().from(crews).where(eq(crews.id, solo.id))).toEqual([]);
    expect(await h.db.select().from(games).where(eq(games.id, 'gSoloGame'))).toEqual([]);
    expect((await h.db.select().from(games).where(eq(games.id, 'gAshaGame')))[0]!.createdBy).toBe(DELETED_USER_ID);
    expect((await h.db.select().from(bugs).where(eq(bugs.id, 'b1')))[0]).toMatchObject({ reporterId: DELETED_USER_ID, screenshotPath: null });
    expect(await h.ctx().uploads.get('asha-game/bugs/b1.png')).toBeNull();
    expect(await h.db.select().from(scores).where(eq(scores.userId, asha.id))).toEqual([]);
    expect(await h.db.select().from(messagesLog).where(eq(messagesLog.nexconnMessageId, 'm1'))).toEqual([]);

    const calls = h.calls.slice(before);
    expect(calls).toEqual(
      expect.arrayContaining([
        { path: '/v4/group-channel/member/kickout-all', body: { userId: nexconnUserId(asha.id) } },
        { path: '/v4/group-channel/dismiss', body: { channelId: solo.groupChannelId } },
      ]),
    );
    expect(calls.some(c => c.path === '/v4/group-channel/dismiss' && c.body.channelId === shared.groupChannelId)).toBe(false);

    // The old session is dead; Riya's crew still works.
    expect((await h.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: asha.cookie } })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: `/api/crews/${shared.id}`, headers: { cookie: riya.cookie } })).json().crew.ownerId).toBe(riya.id);
  });
});

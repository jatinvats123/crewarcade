// HTTP API: guest identity, sessions, Nexconn tokens, crews, invites, roles. Real migrations on
// PGlite, fake Nexconn recording every call.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieSecure } from '../src/config';
import { crewMembers, crews, users } from '../src/db/schema';
import { CREW_GROUP_PERMISSIONS, WELCOME_TEXT } from '../src/services/crews';
import { createHarness, sessionFrom, signUp, WEB, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
afterAll(async () => {
  await h.close();
});

const post = (url: string, cookie: string | undefined, payload?: unknown, origin = WEB) =>
  h.app.inject({ method: 'POST', url, headers: { ...(cookie && { cookie }), origin }, ...(payload !== undefined && { payload: payload as object }) });
const get = (url: string, cookie?: string) => h.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

describe('guest sign-in', () => {
  it('creates a user with a non-sequential id and sets a 90-day httpOnly SameSite=Lax session cookie', async () => {
    const res = await post('/api/auth/guest', undefined, { displayName: '  Riya ', avatarEmoji: '🦊', avatarColor: 'pink', language: 'hi' });
    expect(res.statusCode).toBe(201);
    const { user } = res.json();
    expect(user).toMatchObject({ displayName: 'Riya', avatarEmoji: '🦊', avatarColor: 'pink', language: 'hi', isAgent: false, isJudge: false });
    expect(user.id).toMatch(/^u[A-Za-z0-9]{16}$/);
    expect(user.nexconnId).toBe(user.id);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^ca_session=[\w-]+\.[\w-]+\.[\w-]+; /);
    for (const attr of ['Path=/', 'Max-Age=7776000', 'HttpOnly', 'SameSite=Lax']) expect(cookie).toContain(attr);
    expect(cookie).not.toContain('Secure'); // test env; production adds it:
    expect(cookieSecure({ NODE_ENV: 'production' })).toBe(true);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('validates the body (name 2-24, one of the emojis and colours)', async () => {
    for (const bad of [{ displayName: 'R', avatarEmoji: '🦊', avatarColor: 'pink' }, { displayName: 'Riya', avatarEmoji: 'x', avatarColor: 'pink' }, {}]) {
      const res = await post('/api/auth/guest', undefined, bad);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_request');
    }
  });

  it('rate limits sign-ups per IP (10/min)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/auth/guest',
        remoteAddress: '10.9.9.9',
        payload: { displayName: `Bot ${i}`, avatarEmoji: '🤖', avatarColor: 'cyan' },
      });
      codes.push(res.statusCode);
    }
    expect(codes.filter(c => c === 201)).toHaveLength(10);
    expect(codes.slice(-2)).toEqual([429, 429]);
  });

  it('GET /api/me needs a valid session; PATCH updates the profile', async () => {
    const { cookie } = await signUp(h, 'Sam', '10.0.0.2');
    expect((await get('/api/me')).statusCode).toBe(401);
    expect((await get('/api/me', `${cookie}x`)).statusCode).toBe(401);
    expect((await get('/api/me', cookie)).json().user.displayName).toBe('Sam');
    const patched = await h.app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: { cookie, origin: WEB },
      payload: { displayName: 'Sammy', language: 'ta' },
    });
    expect(patched.json().user).toMatchObject({ displayName: 'Sammy', language: 'ta' });
    expect((await h.app.inject({ method: 'PATCH', url: '/api/me', headers: { cookie }, payload: {} })).statusCode).toBe(400);
  });

  it('expired sessions are rejected', async () => {
    const { cookie } = await signUp(h, 'Old', '10.0.0.3');
    h.now.t += 91 * 24 * 3600 * 1000;
    expect((await get('/api/me', cookie)).statusCode).toBe(401);
    h.now.t -= 91 * 24 * 3600 * 1000;
  });

  it('logout clears the cookie', async () => {
    const res = await post('/api/auth/logout', undefined);
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
  });

  it('blocks mutating requests from other origins', async () => {
    const res = await post('/api/auth/guest', undefined, { displayName: 'Evil', avatarEmoji: '🦊', avatarColor: 'pink' }, 'https://evil.test');
    expect(res.statusCode).toBe(403);
  });
});

describe('Nexconn token', () => {
  it('issues once, caches it encrypted, and re-issues on refresh', async () => {
    const { cookie, id } = await signUp(h, 'Tok', '10.0.0.4');
    const before = h.calls.length;
    const a = await post('/api/nexconn/token', cookie);
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual({ token: expect.stringContaining(`token-for-${id}`), appKey: 'testAppKey', userId: id });
    const issued = h.calls.slice(before);
    expect(issued).toEqual([{ path: '/v4/auth/access-token/issue', body: { userId: id, name: 'Tok' } }]);

    const b = await post('/api/nexconn/token', cookie);
    expect(b.json().token).toBe(a.json().token);
    expect(h.calls.length).toBe(before + 1);

    const [row] = await h.db.select().from(users).where(eq(users.id, id));
    expect(row!.nexconnTokenEncrypted).toMatch(/^v1\./);
    expect(row!.nexconnTokenEncrypted).not.toContain(a.json().token);

    const c = await post('/api/nexconn/token', cookie, { refresh: true });
    expect(c.json().token).not.toBe(a.json().token);
    expect(h.calls.length).toBe(before + 2);
  });

  it('needs a session', async () => {
    expect((await post('/api/nexconn/token', undefined)).statusCode).toBe(401);
  });
});

describe('crews, invites and roles', () => {
  let owner: { cookie: string; id: string };
  let friend: { cookie: string; id: string };
  let crewId = '';
  let channelId = '';
  let inviteCode = '';

  beforeAll(async () => {
    owner = await signUp(h, 'Asha', '10.1.0.1');
    friend = await signUp(h, 'Riya', '10.1.0.2');
  });

  it('creates the crew: Nexconn group with owner + 3 agents, server-controlled membership, Pixel welcome', async () => {
    const before = h.calls.length;
    const res = await post('/api/crews', owner.cookie, { name: ' Friday  crew ' });
    expect(res.statusCode).toBe(201);
    const { crew } = res.json();
    crewId = crew.id;
    channelId = crew.groupChannelId;
    inviteCode = crew.inviteCode;
    expect(crew).toMatchObject({ name: 'Friday crew', kind: 'crew', role: 'owner', memberCount: 4, ownerId: owner.id });
    expect(crew.id).toMatch(/^c[A-Za-z0-9]{16}$/);
    expect(channelId).toMatch(/^crew[A-Za-z0-9]{16}$/);
    expect(inviteCode).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(crew.members.map((m: { displayName: string; role: string; isAgent: boolean }) => [m.displayName, m.role, m.isAgent])).toEqual([
      ['Asha', 'owner', false],
      ['Pixel · Designer', 'member', true],
      ['Forge · Builder', 'member', true],
      ['Glitch · Playtester', 'member', true],
    ]);

    const calls = h.calls.slice(before);
    const paths = calls.map(c => c.path);
    // Tokens for owner + 3 agents first (Nexconn needs registered users), then the group, then the welcome.
    expect(paths.filter(p => p === '/v4/auth/access-token/issue')).toHaveLength(4);
    const create = calls.find(c => c.path === '/v4/group-channel/create')!;
    expect(create.body).toMatchObject({
      channelId,
      name: 'Friday crew',
      owner: owner.id,
      userIds: ['agentpixel', 'agentforge', 'agentglitch'],
      permissions: CREW_GROUP_PERMISSIONS,
    });
    // Live Nexconn rejects unregistered ext_ keys (code 25415), so none are sent; the DB maps channel -> crew.
    expect(create.body).not.toHaveProperty('groupExtProfile');
    const welcome = calls.find(c => c.path === '/v4/group-channel/message/send')!;
    expect(welcome.body).toMatchObject({ fromUserId: 'agentpixel', toChannelIds: [channelId], messageType: 'RC:TxtMsg', shouldPersist: 1 });
    expect(JSON.parse(welcome.body.content as string)).toEqual({ content: WELCOME_TEXT });
    expect(paths.indexOf('/v4/group-channel/create')).toBeLessThan(paths.indexOf('/v4/group-channel/message/send'));
  });

  it('agent tokens are cached: a second crew issues only what is missing', async () => {
    const before = h.calls.length;
    const res = await post('/api/crews', owner.cookie, { name: 'Solo crew' });
    expect(res.statusCode).toBe(201);
    expect(h.calls.slice(before).filter(c => c.path === '/v4/auth/access-token/issue')).toHaveLength(0);
  });

  it('lists my crews; details only for members', async () => {
    const mine = (await get('/api/crews', owner.cookie)).json().crews;
    expect(mine.map((c: { name: string }) => c.name)).toEqual(['Friday crew', 'Solo crew']);
    expect((await get(`/api/crews/${crewId}`, friend.cookie)).statusCode).toBe(404);
    expect((await get(`/api/crews/${crewId}`, owner.cookie)).json().crew.members).toHaveLength(4);
    expect((await get('/api/crews', friend.cookie)).json().crews).toEqual([]);
  });

  it('invite preview is public and minimal', async () => {
    const res = await get(`/api/invites/${inviteCode}`);
    expect(res.statusCode).toBe(200);
    const { invite } = res.json();
    expect(invite).toMatchObject({ crewId, name: 'Friday crew', memberCount: 4, alreadyMember: false, full: false });
    expect(Object.keys(invite.members[0]).sort()).toEqual(['agent', 'avatarColor', 'avatarEmoji', 'avatarUrl', 'displayName', 'isAgent']);
    expect(invite.members.map((m: { agent: string | null }) => m.agent)).toEqual([null, 'pixel', 'forge', 'glitch']);
    expect((await get('/api/invites/ZZZZZZZZ')).statusCode).toBe(404);
    expect((await get('/api/invites/not-a-code')).statusCode).toBe(400);
  });

  it('joining adds the user to the Nexconn group, the DB and posts a notice; joining twice is a no-op', async () => {
    const before = h.calls.length;
    const res = await post(`/api/invites/${inviteCode}/join`, friend.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ crewId, alreadyMember: false });
    const calls = h.calls.slice(before);
    expect(calls.find(c => c.path === '/v4/group-channel/join')!.body).toEqual({ channelId, userIds: [friend.id] });
    const notice = calls.find(c => c.path === '/v4/group-channel/message/send')!;
    expect(notice.body).toMatchObject({ fromUserId: 'agentpixel', messageType: 'CA:Notice', disablePush: true });
    expect(JSON.parse(notice.body.content as string)).toEqual({ kind: 'member_joined', text: 'Riya joined the crew' });

    const again = await post(`/api/invites/${inviteCode}/join`, friend.cookie);
    expect(again.json()).toEqual({ crewId, alreadyMember: true });
    expect(h.calls.slice(before).filter(c => c.path === '/v4/group-channel/join')).toHaveLength(1);
    expect((await get(`/api/invites/${inviteCode}`, friend.cookie)).json().invite.alreadyMember).toBe(true);
    expect((await get(`/api/crews/${crewId}`, friend.cookie)).json().crew.role).toBe('member');
  });

  it('only the owner promotes and demotes approvers; owner and agents never change', async () => {
    const patch = (cookie: string, userId: string, role: string) =>
      h.app.inject({ method: 'PATCH', url: `/api/crews/${crewId}/members/${userId}`, headers: { cookie, origin: WEB }, payload: { role } });
    expect((await patch(friend.cookie, friend.id, 'approver')).statusCode).toBe(403);
    const ok = await patch(owner.cookie, friend.id, 'approver');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().member).toMatchObject({ id: friend.id, role: 'approver' });
    expect((await get(`/api/crews/${crewId}`, friend.cookie)).json().crew.role).toBe('approver');
    // Approvers cannot change roles either.
    expect((await patch(friend.cookie, owner.id, 'member')).statusCode).toBe(403);
    expect((await patch(owner.cookie, owner.id, 'member')).json().error).toBe('owner');
    expect((await patch(owner.cookie, 'agent-pixel', 'approver')).json().error).toBe('agent');
    expect((await patch(owner.cookie, 'uNobody000000000', 'approver')).statusCode).toBe(404);
    expect((await patch(owner.cookie, friend.id, 'owner')).statusCode).toBe(400);
    expect((await patch(owner.cookie, friend.id, 'member')).json().member.role).toBe('member');
  });

  it('a Nexconn failure while creating leaves no crew behind', async () => {
    const countBefore = (await h.db.select().from(crews)).length;
    h.failNext('/v4/group-channel/create', 1002);
    const res = await post('/api/crews', owner.cookie, { name: 'Doomed crew' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('chat_error');
    expect((await h.db.select().from(crews)).length).toBe(countBefore);
  });

  it('a Nexconn failure while joining leaves the membership untouched', async () => {
    const late = await signUp(h, 'Late', '10.1.0.3');
    h.failNext('/v4/group-channel/join', 1000);
    expect((await post(`/api/invites/${inviteCode}/join`, late.cookie)).statusCode).toBe(502);
    expect(await h.db.select().from(crewMembers).where(eq(crewMembers.userId, late.id))).toEqual([]);
  });

  it('needs a session for every crew route', async () => {
    expect((await post('/api/crews', undefined, { name: 'x crew' })).statusCode).toBe(401);
    expect((await get('/api/crews')).statusCode).toBe(401);
    expect((await post(`/api/invites/${inviteCode}/join`, undefined)).statusCode).toBe(401);
  });
});

describe('without Nexconn keys', () => {
  it('chat routes answer 503 but sign-in still works', async () => {
    const bare = await createHarness({ nexconn: false });
    try {
      const res = await bare.app.inject({ method: 'POST', url: '/api/auth/guest', payload: { displayName: 'Solo', avatarEmoji: '🎮', avatarColor: 'gold' } });
      expect(res.statusCode).toBe(201);
      const cookie = sessionFrom(res);
      const tok = await bare.app.inject({ method: 'POST', url: '/api/nexconn/token', headers: { cookie } });
      expect(tok.statusCode).toBe(503);
      expect(tok.json().error).toBe('chat_unavailable');
      expect((await bare.app.inject('/health')).json().nexconn).toBe('not_configured');
    } finally {
      await bare.close();
    }
  }, 60_000);
});

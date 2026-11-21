// Public impact numbers (/api/public/impact): who counts, the funnel, IST days, agent stats, privacy.
import { ImpactResponse } from '@crewarcade/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bugs, crewMembers, crews, games, gameVersions, ledger, scores, users } from '../src/db/schema';
import { groupReferrers, impactStats, istDay, lastIstDays } from '../src/repo/impact';
import { createHarness, type Harness } from './harness';

// 21 Nov 2026, 12:00 UTC = 17:30 IST.
const NOW = Date.parse('2026-11-21T12:00:00Z');
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW - ms);

describe('impact helpers', () => {
  it('days follow India Standard Time', () => {
    expect(istDay(Date.parse('2026-11-20T18:29:00Z'))).toBe('2026-11-20'); // 23:59 IST
    expect(istDay(Date.parse('2026-11-20T18:31:00Z'))).toBe('2026-11-21'); // 00:01 IST
    expect(lastIstDays(NOW, 3)).toEqual(['2026-11-19', '2026-11-20', '2026-11-21']);
  });

  it('groups small, user-typed referrer codes as "other" but always shows direct and invite', () => {
    expect(
      groupReferrers([
        { referrer: 'college', people: 6 },
        { referrer: 'direct', people: 1 },
        { referrer: 'invite', people: 1 },
        { referrer: 'xyz', people: 1 },
        { referrer: 'abc', people: 1 },
      ]),
    ).toEqual([
      { referrer: 'college', people: 6 },
      { referrer: 'other', people: 2 },
      { referrer: 'direct', people: 1 },
      { referrer: 'invite', people: 1 },
    ]);
  });
});

describe('impactStats', () => {
  let h: Harness;
  const spec = { title: 'T' };

  beforeAll(async () => {
    h = await createHarness();
    const person = (id: string, o: Partial<typeof users.$inferInsert> = {}) => ({ id, displayName: `Name ${id}`, createdAt: ago(2 * HOUR), ...o });
    await h.db.insert(users).values([
      person('uasha', { referrer: 'college', lastSeenAt: ago(HOUR) }),
      person('uriya', { referrer: 'college', lastSeenAt: ago(3 * 24 * HOUR) }),
      person('urohan', { lastSeenAt: ago(10 * 24 * HOUR), createdAt: ago(3 * 24 * HOUR) }),
      person('umom', { referrer: 'zz', createdAt: new Date('2026-11-20T18:31:00Z') }), // 00:01 IST on the 21st
      person('ujudge', { isJudge: true }),
      person('uteam', { referrer: 'college' }),
      person('uteamtwo'),
    ]);
    await h.db.insert(crews).values([
      { id: 'cone', groupChannelId: 'gone', name: 'One', ownerId: 'uasha', inviteCode: 'INVONE' },
      { id: 'csolo', groupChannelId: 'gsolo', name: 'Solo', ownerId: 'urohan', inviteCode: 'INVSOLO' },
      { id: 'cteam', groupChannelId: 'gteam', name: 'Team', ownerId: 'uteam', inviteCode: 'INVTEAM' },
    ]);
    await h.db.insert(crewMembers).values([
      { crewId: 'cone', userId: 'uasha', role: 'owner' },
      { crewId: 'cone', userId: 'uriya' },
      { crewId: 'csolo', userId: 'urohan', role: 'owner' },
      { crewId: 'cteam', userId: 'uteam', role: 'owner' },
      { crewId: 'cteam', userId: 'uteamtwo' },
    ]);
    const game = (id: string, o: Partial<typeof games.$inferInsert>) => ({
      id,
      slug: `${id}-game`,
      crewId: 'cone',
      title: `Game ${id}`,
      pitch: 'p',
      createdBy: 'uasha',
      createdAt: ago(HOUR),
      ...o,
    });
    await h.db
      .insert(games)
      .values([
        game('gplan', { status: 'planning' }),
        game('gfail', { status: 'failed', roomChannelId: 'rfail' }),
        game('gpass', { status: 'awaiting_approval', roomChannelId: 'rpass' }),
        game('gpub', { status: 'published', roomChannelId: 'rpub', publishedVersion: 1, createdBy: 'uriya' }),
        game('gteam', { status: 'published', roomChannelId: 'rteam', publishedVersion: 1, crewId: 'cteam', createdBy: 'uteam' }),
      ]);
    await h.db.insert(gameVersions).values([
      { id: 'vfail', gameId: 'gfail', version: 1, spec, status: 'failed' },
      { id: 'vpass', gameId: 'gpass', version: 1, spec, status: 'passed' },
      { id: 'vpub', gameId: 'gpub', version: 1, spec, status: 'published' },
      { id: 'vteam', gameId: 'gteam', version: 1, spec, status: 'published' },
    ]);
    const score = (id: string, gameId: string, userId: string) => ({ id, gameId, version: 1, userId, score: 10, timeMs: 5000 });
    await h.db
      .insert(scores)
      .values([
        score('s1', 'gpub', 'uasha'),
        score('s2', 'gpub', 'uasha'),
        score('s3', 'gteam', 'uriya'),
        score('s4', 'gpub', 'uteam'),
        score('s5', 'gpub', 'ujudge'),
      ]);
    await h.db.insert(bugs).values([
      { id: 'b1', gameId: 'gpub', reporterId: 'uasha', description: 'd', status: 'fixed' },
      { id: 'b2', gameId: 'gpub', reporterId: 'uasha', description: 'd', status: 'open' },
      { id: 'b3', gameId: 'gteam', reporterId: 'uteam', description: 'd', status: 'fixed' },
    ]);
    const row = (id: string, action: string, o: Partial<typeof ledger.$inferInsert> = {}) => ({
      id,
      actorType: 'agent' as const,
      actorId: 'agentforge',
      action,
      summary: action,
      createdAt: ago(HOUR),
      ...o,
    });
    await h.db.insert(ledger).values([
      row('l1', 'build.ready', { gameId: 'gpass', ms: 60_000, costUsd: 0.02 }),
      row('l2', 'build.ready', { gameId: 'gpub', ms: 80_000, costUsd: 0.02 }),
      row('l3', 'test.passed', { gameId: 'gpass', ms: 50_000 }),
      row('l4', 'test.failed', { gameId: 'gfail', ms: 70_000 }),
      row('l5', 'test.passed', { gameId: 'gpub', ms: 60_000 }),
      row('l6', 'build.ready', { gameId: 'gpub', ms: 1, createdAt: ago(40 * 24 * HOUR) }), // outside the 30-day window
    ]);
  }, 60_000);
  afterAll(() => h.close());

  const stats = () => impactStats(h.db, { teamIds: ['uteam', 'uteamtwo'], now: NOW });

  it('counts real people only: no agents, judges, team accounts or the deleted placeholder', async () => {
    const s = await stats();
    expect(s.people).toEqual({
      signedUp: 4,
      active24h: 1,
      active7d: 2,
      byReferrer: [
        { referrer: 'college', people: 2 },
        { referrer: 'direct', people: 1 },
        { referrer: 'other', people: 1 },
      ],
    });
    expect(s.excluded).toEqual({ teamAccounts: 2, judgeAccounts: 1, teamGames: 1 });
  });

  it('a crew counts once it has a real person; "with friends" needs two', async () => {
    expect((await stats()).crews).toEqual({ total: 2, withFriends: 1 });
  });

  it("games, plays and fixes from real people; the team's games and plays are left out", async () => {
    const s = await stats();
    expect(s.games).toEqual({ made: 4, published: 1, plays: 3, players: 2, bugsFixed: 1 });
    expect(s.funnel).toEqual([
      { step: 'pitched', games: 4 },
      { step: 'approved', games: 3 },
      { step: 'built', games: 3 },
      { step: 'passed', games: 2 },
      { step: 'published', games: 1 },
      { step: 'played', games: 1 },
    ]);
    // Plays by real people only (the team's and the judge's plays on gpub are left out).
    expect(s.arcade).toEqual([{ slug: 'gpub-game', title: 'Game gpub', plays: 2 }]);
  });

  it('daily sign-ups and games by IST day, last 7 days, oldest first', async () => {
    const s = await stats();
    expect(s.daily).toHaveLength(7);
    expect(s.daily.at(-1)).toEqual({ day: '2026-11-21', signups: 3, games: 4 });
    expect(s.daily.find(d => d.day === '2026-11-18')).toEqual({ day: '2026-11-18', signups: 1, games: 0 });
  });

  it('agent stats over the last 30 days: playtests, medians and AI cost per built game', async () => {
    expect((await stats()).agents).toEqual({ playtests: 3, passed: 2, medianBuildMs: 70_000, medianTestMs: 60_000, aiCostPerGameUsd: 0.02 });
  });

  it('with no team list set, the team is counted like anyone else', async () => {
    const s = await impactStats(h.db, { teamIds: [], now: NOW });
    expect(s.people.signedUp).toBe(6);
    expect(s.excluded.teamAccounts).toBe(0);
  });
});

describe('GET /api/public/impact', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ env: { TEAM_USER_IDS: 'uteam' } });
    await h.db.insert(users).values([
      { id: 'ureal', displayName: 'Secret Real Name', referrer: 'college' },
      { id: 'uteam', displayName: 'Secret Team Name' },
    ]);
  }, 60_000);
  afterAll(() => h.close());

  it('is public, cached for a minute, valid, honours TEAM_USER_IDS and carries no names', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/public/impact' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const body = ImpactResponse.parse(res.json());
    expect(body.people.signedUp).toBe(1);
    expect(body.excluded.teamAccounts).toBe(1);
    expect(res.body).not.toMatch(/Secret/);
  });
});

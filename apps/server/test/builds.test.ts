// Phase 3 end to end on the server (FAKE_AGENTS build template, fake Nexconn, PGlite, memory storage):
// approve -> Forge build job -> Build card with live progress -> HTML in storage + game_versions ->
// handoff to Glitch + playtest queued -> play URL -> /play with strict headers -> scores ->
// leaderboard -> ScoreCard + challenge DM (throttled). Plus failures + [Try again], change requests
// (Pixel delta -> v2 from v1's code) and remix (v1 from the original's published code).
import { CARD_MESSAGE_TYPES, parseCardMeta, type BuildCardContent, type PlanCardContent } from '@crewarcade/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { channel, type AiClient, type StructuredCall } from '../src/ai/claude';
import { createFakeAiClient } from '../src/ai/fake';
import { cards, games, gameVersions, ledger } from '../src/db/schema';
import { createHarness, signUp, WEB, type Harness, type NexconnCall } from './harness';

/** The fake client, plus: records Forge's prompts, and can be told to fail the next N builds. */
function recordingAi(): AiClient & { forgePrompts: string[]; failNextBuilds: number } {
  const inner = createFakeAiClient({ speed: 0 });
  const me = {
    model: 'fake',
    forgePrompts: [] as string[],
    failNextBuilds: 0,
    structured<T>(call: StructuredCall<T>) {
      if (call.purpose === 'forge.build') {
        me.forgePrompts.push(call.user);
        if (me.failNextBuilds > 0) {
          me.failNextBuilds--;
          const field = channel<string>();
          field.end();
          // Valid JSON, but the code reaches the network: the static check rejects it.
          const bad = {
            outline: 'Player movement',
            code: `const Game = { controls: [], init() {}, update() {}, draw() {}, state() { return {}; } }; fetch('https://x.test');`.padEnd(250, ' '),
            notes: ['x'],
            orientation: 'any',
            emoji: '🎮',
            colors: ['#000000', '#ffffff'],
          };
          return {
            fieldChunks: field.iterable,
            done: Promise.resolve({
              value: call.schema.parse(bad),
              usage: { model: 'fake', tokensIn: 1, tokensOut: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, ms: 1, fellBack: false },
            }),
          };
        }
      }
      return inner.structured(call);
    },
    streamText: inner.streamText.bind(inner),
  };
  return me;
}

let h: Harness;
let ai: ReturnType<typeof recordingAi>;
let asha: { cookie: string; id: string };
let riya: { cookie: string; id: string };
let sam: { cookie: string; id: string };
let channelId: string;
let gameId: string;
let room: string;
let slug: string;

const post = (url: string, cookie: string, payload?: object) =>
  h.app.inject({ method: 'POST', url, headers: { cookie, origin: WEB }, ...(payload && { payload }) });
const get = (url: string, cookie?: string) => h.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
let msgNo = 0;
const say = (from: string, channel: string, text: string, mentions: string[] = []) =>
  h.webhook('message:send', [
    {
      userId: from,
      channelId: channel,
      channelType: 3,
      messageType: 'RC:TxtMsg',
      content: JSON.stringify({ content: text, ...(mentions.length && { mentionedInfo: { type: 2, userIdList: mentions } }) }),
      time: (h.now.t += 1000),
      messageId: `HUMAN-B-${++msgNo}`,
      os: 'Websocket',
    },
  ]);
const sends = (calls: NexconnCall[], type?: string) => calls.filter(c => c.path === '/v4/group-channel/message/send' && (!type || c.body.messageType === type));
const metas = (calls: NexconnCall[]) => calls.filter(c => c.path === '/v4/channel-type/message/metadata/set');
const actions = async (id: string) => (await h.db.select().from(ledger).where(eq(ledger.gameId, id))).map(r => r.action);

async function pitchAndApprove(text: string, channel = channelId, cookie = asha.cookie, from = asha.id): Promise<{ plan: PlanCardContent; room: string }> {
  expect((await say(from, channel, text, ['agentpixel'])).statusCode).toBe(200);
  await h.settle();
  const planCall = sends(h.calls, CARD_MESSAGE_TYPES.plan).at(-1)!;
  const plan = JSON.parse(String(planCall.body.content)) as PlanCardContent;
  const [card] = await h.db
    .select()
    .from(cards)
    .where(and(eq(cards.gameId, plan.gameId), eq(cards.cardType, 'plan'), eq(cards.channelId, channel)));
  const res = await post(`/api/cards/${card!.nexconnMessageId}/approve`, cookie);
  expect(res.statusCode).toBe(200);
  await h.settle();
  const [g] = await h.db.select().from(games).where(eq(games.id, plan.gameId));
  return { plan, room: g!.roomChannelId! };
}

beforeAll(async () => {
  ai = recordingAi();
  h = await createHarness({ agents: true, builds: true, ai, env: { FAKE_AGENTS: '1', PUBLIC_API_ORIGIN: 'https://api.test' } });
  asha = await signUp(h, 'Asha', '10.2.0.1');
  riya = await signUp(h, 'Riya', '10.2.0.2');
  sam = await signUp(h, 'Sam', '10.2.0.3');
  const created = await post('/api/crews', asha.cookie, { name: 'Arcade Crew' });
  channelId = created.json().crew.groupChannelId;
  expect((await post(`/api/invites/${created.json().crew.inviteCode}/join`, riya.cookie)).statusCode).toBe(200);
}, 60_000);
afterAll(async () => {
  await h.close();
});

describe('approve -> Forge builds v1', () => {
  let buildCall: NexconnCall;

  it('posts a Build card that goes building -> ready with live progress lines, then hands off to Glitch', async () => {
    const n = h.calls.length;
    const r = await pitchAndApprove('@pixel a chai cup on a scooter dodging potholes');
    gameId = r.plan.gameId;
    room = r.room;
    slug = r.plan.slug;
    const calls = h.calls.slice(n);
    buildCall = sends(calls, CARD_MESSAGE_TYPES.build).at(-1)!;
    const content = JSON.parse(String(buildCall.body.content)) as BuildCardContent;
    expect(content).toMatchObject({ gameId, slug, version: 1, reason: 'build' });
    expect(parseCardMeta('build', buildCall.body.metadata as Record<string, string>).status).toBe('building');

    const [buildCard] = await h.db
      .select()
      .from(cards)
      .where(and(eq(cards.gameId, gameId), eq(cards.cardType, 'build')));
    const updates = metas(calls)
      .filter(c => c.body.messageId === buildCard!.nexconnMessageId)
      .map(c => parseCardMeta('build', c.body.metadata as Record<string, string>));
    const last = updates.at(-1)!;
    expect(last).toMatchObject({ status: 'ready', checkPass: true, attempts: 1 });
    expect(last.steps.map(s => s.t)).toEqual(['Reading the plan', 'Player movement', 'Falling items + lives', 'Score + juice', 'Running checks', 'Saving v1']);
    expect(last.steps.every(s => s.s === 'done')).toBe(true);
    expect(last.steps.length).toBeGreaterThanOrEqual(4);
    expect(last.steps.length).toBeLessThanOrEqual(7);
    expect(last.notes.length).toBeGreaterThanOrEqual(3);

    // Forge's chip carried a progress fraction while building.
    const forgeStates = sends(calls, 'CA:AgentState')
      .map(c => JSON.parse(String(c.body.content)))
      .filter(s => s.agentId === 'forge');
    expect(forgeStates.some(s => s.state === 'building' && s.progress?.total >= 4)).toBe(true);
    expect(forgeStates.some(s => s.state === 'checking')).toBe(true);
    expect(forgeStates.at(-1).state).toBe('idle');

    // Then Forge -> Glitch, and (FAKE) a simulated PASS card.
    const handoffs = sends(calls, CARD_MESSAGE_TYPES.handoff).map(c => JSON.parse(String(c.body.content)));
    expect(handoffs.at(-1)).toMatchObject({ from: 'forge', to: 'glitch', task: 'Test v1 against the acceptance list' });
    expect(h.agents!.queue.playtests).toHaveLength(1);
    expect(sends(calls, CARD_MESSAGE_TYPES.test)).toHaveLength(1);
  });

  it('stores the HTML in the games bucket and the version row with metrics labelled by model', async () => {
    const [v] = await h.db
      .select()
      .from(gameVersions)
      .where(and(eq(gameVersions.gameId, gameId), eq(gameVersions.version, 1)));
    expect(v).toMatchObject({ htmlPath: `games/${slug}/v1/index.html`, model: 'fake', status: 'passed' });
    expect(v!.sizeBytes).toBeGreaterThan(10_000);
    expect(v!.buildMs).toBeGreaterThanOrEqual(0);
    expect(v!.meta).toMatchObject({ orientation: 'portrait', attempts: 1, reason: 'build' });
    expect(h.storage.objects.get(`${slug}/v1/index.html`)?.toString('utf8')).toContain('=== GAME START ===');
    expect(await actions(gameId)).toEqual(expect.arrayContaining(['build.queued', 'build.started', 'build.ready', 'handoff', 'test.passed']));
  });

  it('a duplicate build job is a no-op (idempotent)', async () => {
    const n = h.calls.length;
    await h.agents!.queue.enqueueBuild({ key: `${gameId}:v1:again`, gameId, version: 1, channelId: room, handoffMessageId: 'x' });
    await h.settle();
    expect(sends(h.calls.slice(n), CARD_MESSAGE_TYPES.build)).toHaveLength(0);
  });
});

describe('playing: signed URLs and strict headers', () => {
  let url: string;

  it('crew members get a signed play URL; outsiders get 404', async () => {
    const res = await get(`/api/games/${gameId}/versions/1/play`, riya.cookie);
    expect(res.statusCode).toBe(200);
    url = res.json().url;
    expect(url).toMatch(new RegExp(`^https://api\\.test/play/${slug}/v/1\\?t=`));
    expect(res.json()).toMatchObject({ version: 1, orientation: 'portrait', expiresAt: expect.any(Number) });
    expect((await get(`/api/games/${gameId}/versions/1/play`, sam.cookie)).statusCode).toBe(404);
    expect((await get(`/api/games/${gameId}/versions/1/play`)).statusCode).toBe(404);
    expect((await get(`/api/games/${gameId}/versions/latest/play`, asha.cookie)).json().version).toBe(1);
  });

  it('/play serves the game with the strict CSP, nosniff, no-referrer and immutable caching', async () => {
    const path = url.replace('https://api.test', '');
    const res = await get(path);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("connect-src 'none'");
    expect(res.headers['content-security-policy']).toContain(`frame-ancestors ${WEB}`);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toMatch(/immutable/);
    expect(res.body).toContain('window.__crew');
  });

  it('without a valid token, unpublished versions are 404 (also for a tampered or other-version token)', async () => {
    const path = url.replace('https://api.test', '');
    expect((await get(path.split('?')[0]!)).statusCode).toBe(404);
    expect((await get(path.replace('/v/1', '/v/2'))).statusCode).toBe(404);
    expect((await get(`${path.slice(0, -3)}abc`)).statusCode).toBe(404);
    expect((await get('/play/no-such-game/v/1')).statusCode).toBe(404);
  });
});

describe('scores, leaderboard, ScoreCard and challenge DMs', () => {
  it('accepts a plausible score and rejects too-fast, too-short and too-high ones', async () => {
    let r = await post('/api/scores', asha.cookie, { gameId, version: 1, score: 990, timeMs: 30_000 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ accepted: true, best: 990, rank: 1, newBest: true });
    r = await post('/api/scores', asha.cookie, { gameId, version: 1, score: 1000, timeMs: 30_000 });
    expect(r.statusCode).toBe(429);
    h.now.t += 3500;
    r = await post('/api/scores', asha.cookie, { gameId, version: 1, score: 50, timeMs: 200 });
    expect(r.statusCode).toBe(422);
    h.now.t += 3500;
    r = await post('/api/scores', asha.cookie, { gameId, version: 1, score: 5_000_000, timeMs: 30_000 });
    expect(r.statusCode).toBe(422);
    expect((await post('/api/scores', sam.cookie, { gameId, version: 1, score: 10, timeMs: 5000 })).statusCode).toBe(404);
    expect(
      (await h.app.inject({ method: 'POST', url: '/api/scores', headers: { origin: WEB }, payload: { gameId, version: 1, score: 1, timeMs: 5000 } }))
        .statusCode,
    ).toBe(401);
  });

  it('beating a crew member posts a ScoreCard and DMs the beaten player once per hour', async () => {
    h.now.t += 5000;
    const n = h.calls.length;
    const r = await post('/api/scores', riya.cookie, { gameId, version: 1, score: 1240, timeMs: 45_000 });
    expect(r.json()).toMatchObject({ accepted: true, rank: 1 });
    const card = sends(h.calls.slice(n), CARD_MESSAGE_TYPES.score).at(-1)!;
    expect(card.body.toChannelIds).toEqual([room]);
    expect(JSON.parse(String(card.body.content))).toMatchObject({ playerName: 'Riya', beatPlayerName: 'Asha', score: 1240, beatScore: 990, rank: 1 });
    const dms = h.calls.slice(n).filter(c => c.path === '/v4/direct-channel/message/send');
    expect(dms).toHaveLength(1);
    expect(dms[0]!.body).toMatchObject({ fromUserId: 'agentglitch', toUserIds: [asha.id.replace(/[^A-Za-z0-9]/g, '')] });
    expect(JSON.parse(String(dms[0]!.body.content)).content).toMatch(
      /Riya just beat your best .*1240.*Play again: https:\/\/web\.test\/crews\/.*\/rooms\/.*\?play=latest/s,
    );

    // Asha takes it back, then Riya beats her again within the hour: a card, but no second DM to Asha.
    h.now.t += 5000;
    await post('/api/scores', asha.cookie, { gameId, version: 1, score: 1500, timeMs: 50_000 });
    h.now.t += 5000;
    const m = h.calls.length;
    await post('/api/scores', riya.cookie, { gameId, version: 1, score: 1600, timeMs: 50_000 });
    expect(sends(h.calls.slice(m), CARD_MESSAGE_TYPES.score)).toHaveLength(1);
    expect(h.calls.slice(m).filter(c => c.path === '/v4/direct-channel/message/send')).toHaveLength(0);
    // An hour later the pair may be challenged again.
    h.now.t += 60 * 60 * 1000;
    await post('/api/scores', asha.cookie, { gameId, version: 1, score: 1700, timeMs: 50_000 });
    h.now.t += 5000;
    const k = h.calls.length;
    await post('/api/scores', riya.cookie, { gameId, version: 1, score: 1800, timeMs: 50_000 });
    expect(h.calls.slice(k).filter(c => c.path === '/v4/direct-channel/message/send')).toHaveLength(1);
  });

  it('a lower score than your best posts nothing', async () => {
    h.now.t += 5000;
    const n = h.calls.length;
    const r = await post('/api/scores', riya.cookie, { gameId, version: 1, score: 100, timeMs: 50_000 });
    expect(r.json()).toMatchObject({ accepted: true, best: 1800, newBest: false });
    expect(sends(h.calls.slice(n), CARD_MESSAGE_TYPES.score)).toHaveLength(0);
  });

  it('the leaderboard has one row per player, best first, plus my best and rank', async () => {
    const res = await get(`/api/games/${gameId}/leaderboard`, asha.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().top.map((e: { name: string; score: number; rank: number }) => [e.rank, e.name, e.score])).toEqual([
      [1, 'Riya', 1800],
      [2, 'Asha', 1700],
    ]);
    expect(res.json().me).toEqual({ best: 1700, rank: 2 });
    expect((await get(`/api/games/${gameId}/leaderboard`, sam.cookie)).statusCode).toBe(404);
  });
});

describe('failures, [Try again], change requests', () => {
  it('a build that fails the checks 3 times posts a failed card + friendly line; Try again rebuilds it', async () => {
    ai.failNextBuilds = 3;
    const n = h.calls.length;
    const second = await pitchAndApprove('@pixel a penguin delivering pizza across icy rooftops');
    const calls = h.calls.slice(n);
    const [card] = await h.db
      .select()
      .from(cards)
      .where(and(eq(cards.gameId, second.plan.gameId), eq(cards.cardType, 'build')));
    const lastMeta = metas(calls)
      .filter(c => c.body.messageId === card!.nexconnMessageId)
      .map(c => parseCardMeta('build', c.body.metadata as Record<string, string>))
      .at(-1)!;
    expect(lastMeta).toMatchObject({ status: 'failed', checkPass: false, attempts: 3 });
    expect(lastMeta.problems[0]).toMatch(/fetch/);
    const texts = sends(calls, 'RC:TxtMsg').map(c => JSON.parse(String(c.body.content)).content as string);
    expect(texts.some(t => /couldn't get v1 past the checks after 3 tries/.test(t))).toBe(true);
    expect(await actions(second.plan.gameId)).toEqual(expect.arrayContaining(['build.check_failed', 'build.failed']));
    expect((await h.db.select().from(games).where(eq(games.id, second.plan.gameId)))[0]!.status).toBe('failed');

    // Outsiders cannot retry; a member can, once.
    expect((await post(`/api/cards/${card!.nexconnMessageId}/retry`, sam.cookie)).statusCode).toBe(404);
    const retry = await post(`/api/cards/${card!.nexconnMessageId}/retry`, riya.cookie);
    expect(retry.statusCode).toBe(200);
    expect((await post(`/api/cards/${card!.nexconnMessageId}/retry`, riya.cookie)).statusCode).toBe(409);
    await h.settle();
    const [v] = await h.db
      .select()
      .from(gameVersions)
      .where(and(eq(gameVersions.gameId, second.plan.gameId), eq(gameVersions.version, 1)));
    expect(v).toMatchObject({ status: 'passed', htmlPath: expect.stringContaining('/v1/index.html') });
  });

  it('"@forge make it faster" in the game room: Pixel writes a delta, Forge builds v2 from v1', async () => {
    const before = ai.forgePrompts.length;
    const n = h.calls.length;
    expect((await say(riya.id, room, '@forge make it faster', ['agentforge'])).statusCode).toBe(200);
    await h.settle();
    const calls = h.calls.slice(n);
    const builds = sends(calls, CARD_MESSAGE_TYPES.build).map(c => JSON.parse(String(c.body.content)) as BuildCardContent);
    expect(builds).toEqual([expect.objectContaining({ version: 2, reason: 'change', change: expect.stringMatching(/faster/) })]);
    const prompt = ai.forgePrompts[before]!;
    expect(prompt).toContain('<previous_code>');
    expect(prompt).toContain('<untrusted kind="change request">');
    const [v2] = await h.db
      .select()
      .from(gameVersions)
      .where(and(eq(gameVersions.gameId, gameId), eq(gameVersions.version, 2)));
    expect((v2!.spec as { changes: Array<{ version: number; askedBy: string[] }> }).changes).toEqual([
      expect.objectContaining({ version: 2, askedBy: ['Riya'] }),
    ]);
    expect(v2!.htmlPath).toBe(`games/${slug}/v2/index.html`);
    expect(await actions(gameId)).toEqual(expect.arrayContaining(['plan.revised']));
    // v1 stays playable.
    expect((await get(`/api/games/${gameId}/versions/1/play`, asha.cookie)).statusCode).toBe(200);
    const versions = (await get(`/api/games/${gameId}/versions`, asha.cookie)).json().versions as Array<{ version: number }>;
    expect(versions.map(v => v.version)).toEqual([2, 1]);
  });

  it('[Change] on a Build card queues the same flow (members only)', async () => {
    const [card] = await h.db
      .select()
      .from(cards)
      .where(and(eq(cards.gameId, gameId), eq(cards.cardType, 'build'), eq(cards.version, 2)));
    expect((await post(`/api/cards/${card!.nexconnMessageId}/change`, sam.cookie, { text: 'more stars' })).statusCode).toBe(404);
    const r = await post(`/api/cards/${card!.nexconnMessageId}/change`, asha.cookie, { text: 'more stars please' });
    expect(r.statusCode).toBe(200);
    await h.settle();
    const [v3] = await h.db
      .select()
      .from(gameVersions)
      .where(and(eq(gameVersions.gameId, gameId), eq(gameVersions.version, 3)));
    expect(v3?.htmlPath).toBe(`games/${slug}/v3/index.html`);
  });
});

describe('public game page and remix', () => {
  it('the story (ledger) is members-only until the game is published', async () => {
    expect((await get(`/api/games/${gameId}/ledger`)).statusCode).toBe(404);
    expect((await get(`/api/games/${gameId}/ledger`, sam.cookie)).statusCode).toBe(404);
    expect((await get(`/api/games/${gameId}/ledger`, riya.cookie)).statusCode).toBe(200);
  });

  it('a draft shows the teaser only (no play link, no versions)', async () => {
    const res = await get(`/api/public/games/${slug}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ slug, playUrl: null, publishedVersion: null, versions: [], crew: { name: 'Arcade Crew' } });
    expect(res.json().crew.members.map((m: { name: string }) => m.name)).toEqual(['Asha', 'Riya']);
  });

  it('once published (Phase 4 sets this; here directly): public play URL, leaderboard and versions', async () => {
    await h.db.update(games).set({ publishedVersion: 2, status: 'published' }).where(eq(games.id, gameId));
    const page = (await get(`/api/public/games/${slug}`)).json();
    expect(page).toMatchObject({ publishedVersion: 2, playUrl: `https://api.test/play/${slug}/v/2`, emoji: '🎮' });
    expect(page.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const play = await get(`/play/${slug}/v/2`);
    expect(play.statusCode).toBe(200);
    expect(play.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await get(`/api/games/${gameId}/leaderboard`)).statusCode).toBe(200);
    expect((await get(`/api/games/${gameId}/ledger`)).statusCode).toBe(200);
    // Anyone signed in may now score the published version.
    h.now.t += 5000;
    expect((await post('/api/scores', sam.cookie, { gameId, version: 2, score: 10, timeMs: 5000 })).statusCode).toBe(200);
  });

  it('Remix this: a new crew, Pixel plans the remix, and v1 starts from the original published code', async () => {
    expect(
      (await h.app.inject({ method: 'POST', url: `/api/games/${slug}/remix`, headers: { origin: WEB }, payload: { newCrewName: 'Remixers' } })).statusCode,
    ).toBe(401);
    const before = ai.forgePrompts.length;
    const r = await post(`/api/games/${slug}/remix`, sam.cookie, { newCrewName: 'Remixers', idea: 'with mangoes' });
    expect(r.statusCode).toBe(200);
    await h.settle();
    const samChannel = r.json().channelId as string;
    const planCall = sends(h.calls, CARD_MESSAGE_TYPES.plan)
      .filter(c => (c.body.toChannelIds as string[])[0] === samChannel)
      .at(-1)!;
    const plan = JSON.parse(String(planCall.body.content)) as PlanCardContent;
    const [g] = await h.db.select().from(games).where(eq(games.id, plan.gameId));
    expect(g!.remixOfGameId).toBe(gameId);
    const [card] = await h.db
      .select()
      .from(cards)
      .where(and(eq(cards.gameId, plan.gameId), eq(cards.cardType, 'plan'), eq(cards.channelId, samChannel)));
    expect((await post(`/api/cards/${card!.nexconnMessageId}/approve`, sam.cookie)).statusCode).toBe(200);
    await h.settle();
    const prompt = ai.forgePrompts[before]!;
    expect(prompt).toContain('This is a remix of');
    expect(prompt).toContain('<previous_code>');
    const [v1] = await h.db
      .select()
      .from(gameVersions)
      .where(and(eq(gameVersions.gameId, plan.gameId), eq(gameVersions.version, 1)));
    expect(v1!.meta).toMatchObject({ reason: 'remix' });
    expect((await get(`/api/public/games/${slug}`)).json().remixes.map((x: { slug: string }) => x.slug)).toContain(g!.slug);
  });

  it('unpublished games cannot be remixed', async () => {
    const other = await h.db.select().from(games).where(eq(games.status, 'testing'));
    const target = other.find(x => x.id !== gameId);
    if (target) expect((await post(`/api/games/${target.slug}/remix`, sam.cookie, { newCrewName: 'Nope' })).statusCode).toBe(404);
  });
});

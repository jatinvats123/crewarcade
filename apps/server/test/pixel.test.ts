// Phase 2 end to end on the server (FAKE_AGENTS client, fake Nexconn, real migrations on PGlite):
// pitch webhook -> router -> job -> states -> streamed intro -> PlanCard -> votes -> approve ->
// game room + RoomLink + approved copy + handoff + queued build -> ledger. Plus change requests,
// explain, remix, refusals, stream failures, idempotency and permissions.
import { CARD_MESSAGE_TYPES, parseCardMeta, type PlanCardContent } from '@crewarcade/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiRefusalError, channel, type AiClient } from '../src/ai/claude';
import { cards, crews, gameVersions, games, ledger } from '../src/db/schema';
import { createHarness, signUp, WEB, type Harness, type NexconnCall } from './harness';

let h: Harness;
let asha: { cookie: string; id: string };
let riya: { cookie: string; id: string };
let sam: { cookie: string; id: string };
let crewId: string;
let channelId: string;

const post = (url: string, cookie: string, payload?: object) =>
  h.app.inject({ method: 'POST', url, headers: { cookie, origin: WEB }, ...(payload && { payload }) });
const get = (url: string, cookie: string) => h.app.inject({ method: 'GET', url, headers: { cookie } });
let msgNo = 0;
const textEvent = (from: string, channel: string, text: string, mentions: string[] = [], messageId = `HUMAN-${++msgNo}`) => ({
  ...tick(),
  userId: from,
  channelId: channel,
  channelType: 3,
  messageType: 'RC:TxtMsg',
  content: JSON.stringify({ content: text, ...(mentions.length && { mentionedInfo: { type: 2, userIdList: mentions } }) }),
  time: h.now.t,
  messageId,
  os: 'Websocket',
});
/** Moves the clock on, so rows written by each step have distinct times (as in real life). */
const tick = () => {
  h.now.t += 1000;
  return {};
};
const since = (n: number) => h.calls.slice(n);
const sends = (calls: NexconnCall[], type?: string) => calls.filter(c => c.path === '/v4/group-channel/message/send' && (!type || c.body.messageType === type));
const streams = (calls: NexconnCall[]) => calls.filter(c => c.path === '/v4/group-channel/message/stream/send');
const metas = (calls: NexconnCall[]) => calls.filter(c => c.path === '/v4/channel-type/message/metadata/set');
const actions = async (gameId: string) => (await h.db.select().from(ledger).where(eq(ledger.gameId, gameId))).map(r => r.action);

async function pitch(text: string, from = asha.id, mentions = ['agentpixel']): Promise<{ messageId: string; content: PlanCardContent; calls: NexconnCall[] }> {
  const n = h.calls.length;
  expect((await h.webhook('message:send', [textEvent(from, channelId, text, mentions)])).statusCode).toBe(200);
  await h.settle();
  const calls = since(n);
  const card = sends(calls, CARD_MESSAGE_TYPES.plan).at(-1);
  if (!card) throw new Error(`no plan card posted for "${text}"`);
  const content = JSON.parse(String(card.body.content)) as PlanCardContent;
  const rows = await h.db.select().from(cards).where(eq(cards.gameId, content.gameId));
  const mine = rows.find(c => c.cardType === 'plan' && c.version === content.version && c.channelId === channelId)!;
  return { messageId: mine.nexconnMessageId, content, calls };
}

beforeAll(async () => {
  h = await createHarness({ agents: true });
  asha = await signUp(h, 'Asha', '10.1.0.1');
  riya = await signUp(h, 'Riya', '10.1.0.2');
  sam = await signUp(h, 'Sam', '10.1.0.3');
  const created = await post('/api/crews', asha.cookie, { name: 'Chai Crew' });
  expect(created.statusCode).toBe(201);
  crewId = created.json().crew.id;
  channelId = created.json().crew.groupChannelId;
  const code = created.json().crew.inviteCode;
  expect((await post(`/api/invites/${code}/join`, riya.cookie)).statusCode).toBe(200);
}, 60_000);
afterAll(async () => {
  await h.close();
});

describe('pitch -> streamed intro -> plan card', () => {
  let plan: Awaited<ReturnType<typeof pitch>>;
  let gameRoom: string;

  it('Pixel thinks, streams a short intro, then posts a PlanCard with live metadata', async () => {
    plan = await pitch('@pixel a chai cup on a scooter dodging potholes');
    const states = sends(plan.calls, 'CA:AgentState').map(c => JSON.parse(String(c.body.content)));
    expect(states.map(s => s.state)).toEqual(expect.arrayContaining(['thinking', 'designing', 'waiting_approval']));
    expect(states.indexOf(states.find(s => s.state === 'thinking'))).toBeLessThan(states.indexOf(states.find(s => s.state === 'designing')));
    for (const c of sends(plan.calls, 'CA:AgentState')) expect(c.body).toMatchObject({ shouldPersist: 0, disablePush: true, fromUserId: 'agentpixel' });

    const chunks = streams(plan.calls);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const first = chunks[0]!.body;
    expect(first).toMatchObject({ fromUserId: 'agentpixel', toChannelId: channelId, messageType: 'RC:StreamMsg' });
    expect(first.content).toMatchObject({ seq: 1, type: 'markdown', user: { id: 'agentpixel', name: 'Pixel · Designer' } });
    expect(chunks.map(c => (c.body.content as { seq: number }).seq)).toEqual(chunks.map((_, i) => i + 1));
    expect((chunks.at(-1)!.body.content as { complete: boolean }).complete).toBe(true);
    const intro = chunks.map(c => (c.body.content as { content: string }).content).join('');
    expect(intro).toContain(`Ooh, I love this! Planning *${plan.content.title}*`);
    expect(plan.content.title).toMatch(/^Chai /);

    // The card comes after the intro, with hasMetadata and the initial vote state.
    const cardCall = sends(plan.calls, CARD_MESSAGE_TYPES.plan)[0]!;
    expect(plan.calls.indexOf(cardCall)).toBeGreaterThan(plan.calls.indexOf(chunks.at(-1)!));
    expect(cardCall.body).toMatchObject({ fromUserId: 'agentpixel', toChannelIds: [channelId], hasMetadata: true });
    expect(parseCardMeta('plan', cardCall.body.metadata as Record<string, string>)).toMatchObject({ status: 'pending', yes: 0, no: 0, voters: {} });
    expect(plan.content).toMatchObject({ v: 1, version: 1, language: 'en', credits: ['Asha'] });
    expect(plan.content.slug).toBe(plan.content.title.toLowerCase().replace(/ /g, '-'));
    expect(plan.content.acceptance.length).toBeGreaterThanOrEqual(4);
    expect(plan.content.acceptance.length).toBeLessThanOrEqual(8);

    const [game] = await h.db.select().from(games).where(eq(games.id, plan.content.gameId));
    expect(game).toMatchObject({ slug: plan.content.slug, status: 'planning', crewId, createdBy: asha.id, roomChannelId: null });
    expect(await actions(plan.content.gameId)).toEqual(['plan.created']);
  });

  it('a second plan with the same title gets a unique slug', async () => {
    const again = await pitch('@pixel a chai glass racing on rooftops');
    expect(again.content.title).toBe(plan.content.title);
    expect(again.content.slug).toBe(`${plan.content.slug}-2`);
  });

  it('members vote live; one vote each, switching allowed; the server owns the count', async () => {
    const n = h.calls.length;
    const r1 = await post(`/api/cards/${plan.messageId}/vote`, riya.cookie, { vote: 'yes' });
    expect(r1.statusCode).toBe(200);
    expect(parseCardMeta('plan', r1.json().metadata)).toMatchObject({ yes: 1, no: 0 });
    expect((await post(`/api/cards/${plan.messageId}/vote`, asha.cookie, { vote: 'no' })).json().metadata).toMatchObject({ yes: '1', no: '1' });
    const r3 = await post(`/api/cards/${plan.messageId}/vote`, asha.cookie, { vote: 'yes' });
    expect(parseCardMeta('plan', r3.json().metadata)).toMatchObject({ yes: 2, no: 0, voters: { [asha.id]: 'yes', [riya.id]: 'yes' } });
    // Same vote twice: no Nexconn call.
    const before = h.calls.length;
    expect((await post(`/api/cards/${plan.messageId}/vote`, riya.cookie, { vote: 'yes' })).statusCode).toBe(200);
    expect(metas(since(before))).toHaveLength(0);
    const m = metas(since(n));
    expect(m).toHaveLength(3);
    expect(m[0]!.body).toMatchObject({ messageId: plan.messageId, channelType: 3, channelId, userId: riya.id, isEchoToSender: 1 });
    expect((await post(`/api/cards/${plan.messageId}/vote`, riya.cookie, { vote: 'maybe' })).statusCode).toBe(400);
  });

  it('concurrent votes are not lost', async () => {
    const extra = await pitch('@pixel penguins sliding down a rainbow');
    const res = await Promise.all([
      post(`/api/cards/${extra.messageId}/vote`, asha.cookie, { vote: 'yes' }),
      post(`/api/cards/${extra.messageId}/vote`, riya.cookie, { vote: 'no' }),
    ]);
    expect(res.map(r => r.statusCode)).toEqual([200, 200]);
    const [row] = await h.db.select().from(cards).where(eq(cards.nexconnMessageId, extra.messageId));
    expect((row!.state as { voters: Record<string, string> }).voters).toEqual({ [asha.id]: 'yes', [riya.id]: 'no' });
  });

  it('only crew members can vote; only owner/approvers can approve', async () => {
    expect((await post(`/api/cards/${plan.messageId}/vote`, sam.cookie, { vote: 'yes' })).statusCode).toBe(404);
    expect((await post(`/api/cards/${plan.messageId}/approve`, sam.cookie)).statusCode).toBe(404);
    const r = await post(`/api/cards/${plan.messageId}/approve`, riya.cookie);
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('not_approver');
    expect((await post('/api/cards/NOPE-1/vote', asha.cookie, { vote: 'yes' })).statusCode).toBe(404);
  });

  it('approval creates the game room, RoomLink, approved copy + handoff, queues v1, and remembers a preference', async () => {
    const n = h.calls.length;
    const res = await post(`/api/cards/${plan.messageId}/approve`, asha.cookie);
    expect(res.statusCode).toBe(200);
    const meta = parseCardMeta('plan', res.json().metadata);
    expect(meta).toMatchObject({ status: 'approved', approvedBy: 'Asha', yes: 2 });
    gameRoom = meta.roomChannelId!;
    expect(gameRoom).toMatch(/^game[A-Za-z0-9]{16}$/);
    const calls = since(n);

    const create = calls.find(c => c.path === '/v4/group-channel/create')!;
    expect(create.body).toMatchObject({
      channelId: gameRoom,
      name: `🎮 ${plan.content.title}`,
      owner: asha.id,
    });
    expect(create.body).not.toHaveProperty('groupExtProfile'); // unregistered ext_ keys fail live (25415)
    expect((create.body.userIds as string[]).sort()).toEqual([riya.id, 'agentforge', 'agentglitch', 'agentpixel'].sort());

    const link = sends(calls, CARD_MESSAGE_TYPES.roomLink)[0]!;
    expect(link.body.toChannelIds).toEqual([channelId]);
    expect(JSON.parse(String(link.body.content))).toEqual({
      v: 1,
      channelId: gameRoom,
      gameId: plan.content.gameId,
      title: `🎮 ${plan.content.title}`,
      kind: 'game',
    });

    const copy = sends(calls, CARD_MESSAGE_TYPES.plan)[0]!;
    expect(copy.body.toChannelIds).toEqual([gameRoom]);
    expect(parseCardMeta('plan', copy.body.metadata as Record<string, string>).status).toBe('approved');
    const handoff = sends(calls, CARD_MESSAGE_TYPES.handoff)[0]!;
    expect(handoff.body.toChannelIds).toEqual([gameRoom]);
    expect(JSON.parse(String(handoff.body.content))).toMatchObject({ from: 'pixel', to: 'forge', task: 'Build v1 from this plan' });
    expect(handoff.body.metadata).toEqual({ status: 'waiting' });
    expect(calls.indexOf(copy)).toBeLessThan(calls.indexOf(handoff));

    expect(h.agents!.queue.builds).toEqual([expect.objectContaining({ gameId: plan.content.gameId, version: 1, channelId: gameRoom })]);
    const [game] = await h.db.select().from(games).where(eq(games.id, plan.content.gameId));
    expect(game).toMatchObject({ status: 'building', roomChannelId: gameRoom });
    const [v1] = await h.db.select().from(gameVersions).where(eq(gameVersions.gameId, plan.content.gameId));
    expect(v1).toMatchObject({ version: 1, status: 'building' });
    expect((v1!.spec as { approvedBy: string[] }).approvedBy).toEqual(['Asha']);

    const [crew] = await h.db.select().from(crews).where(eq(crews.id, crewId));
    expect((crew!.settings as { memory: string[] }).memory).toEqual(['likes Indian everyday themes']);

    expect(await actions(plan.content.gameId)).toEqual([
      'plan.created',
      'plan.vote',
      'plan.vote',
      'plan.vote',
      'plan.approved',
      'room.created',
      'handoff',
      'build.queued',
      'crew.memory_updated',
    ]);
  });

  it('a plan is approved once; votes close after approval', async () => {
    const again = await post(`/api/cards/${plan.messageId}/approve`, asha.cookie);
    expect(again.statusCode).toBe(409);
    expect((await post(`/api/cards/${plan.messageId}/vote`, riya.cookie, { vote: 'no' })).statusCode).toBe(409);
  });

  it('the room endpoint and the ledger API describe the game (members only)', async () => {
    const room = await get(`/api/rooms/${gameRoom}`, riya.cookie);
    expect(room.json().room).toMatchObject({ kind: 'game', crewId, game: { id: plan.content.gameId, title: plan.content.title, status: 'building' } });
    expect((await get(`/api/rooms/${channelId}`, riya.cookie)).json().room).toMatchObject({ kind: 'crew', game: null });
    expect((await get(`/api/rooms/${gameRoom}`, sam.cookie)).statusCode).toBe(404);

    const l = await get(`/api/games/${plan.content.gameId}/ledger`, riya.cookie);
    expect(l.statusCode).toBe(200);
    const body = l.json();
    expect(body.entries[0]).toMatchObject({ action: 'plan.created', actorType: 'agent', actorName: 'Pixel · Designer' });
    expect(body.entries.find((e: { action: string }) => e.action === 'plan.approved')).toMatchObject({ actorType: 'human', actorName: 'Asha' });
    expect(body.entries.find((e: { action: string }) => e.action === 'room.created')).toMatchObject({ actorType: 'system', actorName: 'CrewArcade' });
    expect(body.totals).toMatchObject({ tokensIn: 0, costUsd: 0 });
    expect((await get(`/api/games/${plan.content.gameId}/ledger`, sam.cookie)).statusCode).toBe(404);

    const act = await get(`/api/crews/${crewId}/agents/pixel/activity`, riya.cookie);
    expect(act.json().entries.length).toBeLessThanOrEqual(5);
    expect(act.json().entries[0].actorName).toBe('Pixel · Designer');

    const detail = await get(`/api/crews/${crewId}`, riya.cookie);
    expect(detail.json().crew.games.map((g: { slug: string }) => g.slug)).toContain(plan.content.slug);
  });

  it('@pixel explain in the game room streams at most 8 lines from the plan and logs it', async () => {
    const n = h.calls.length;
    await h.webhook('message:send', [textEvent(riya.id, gameRoom, '@pixel explain how does the jump work?', ['agentpixel'])]);
    await h.settle();
    const text = streams(since(n))
      .map(c => (c.body.content as { content: string }).content)
      .join('');
    expect(text).toContain(plan.content.title);
    expect(text.trim().split('\n').length).toBeLessThanOrEqual(8);
    expect(await actions(plan.content.gameId)).toContain('agent.explained');
  });

  it('new members joining later are added to existing game rooms', async () => {
    const [crew] = await h.db.select().from(crews).where(eq(crews.id, crewId));
    const n = h.calls.length;
    expect((await post(`/api/invites/${crew!.inviteCode}/join`, sam.cookie)).statusCode).toBe(200);
    const joins = since(n).filter(c => c.path === '/v4/group-channel/join');
    expect(joins.map(j => j.body.channelId)).toEqual(expect.arrayContaining([channelId, gameRoom]));
  });
});

describe('change requests', () => {
  it('[Change] marks the card, Pixel posts plan v2 and supersedes v1', async () => {
    const v1 = await pitch('@pixel a cat dodging cucumbers in a kitchen');
    const n = h.calls.length;
    const res = await post(`/api/cards/${v1.messageId}/change`, riya.cookie, { text: 'make it faster' });
    expect(res.statusCode).toBe(200);
    expect(res.json().metadata.status).toBe('changes_requested');
    await h.settle();
    const calls = since(n);
    const v2card = sends(calls, CARD_MESSAGE_TYPES.plan)[0]!;
    const v2 = JSON.parse(String(v2card.body.content)) as PlanCardContent;
    expect(v2).toMatchObject({ version: 2, gameId: v1.content.gameId, title: v1.content.title, credits: ['Asha', 'Riya'] });
    expect(v2.acceptance.some(a => a.text.includes('1.5x'))).toBe(true);
    const superseded = metas(calls).find(m => m.body.messageId === v1.messageId && (m.body.metadata as { status?: string }).status === 'superseded');
    expect(superseded).toBeTruthy();
    expect((await post(`/api/cards/${v1.messageId}/approve`, asha.cookie)).statusCode).toBe(409);
    expect(await actions(v1.content.gameId)).toEqual(['plan.created', 'plan.change_requested', 'plan.revised']);
    expect((await post(`/api/cards/${v1.messageId}/change`, riya.cookie, { text: 'x' })).statusCode).toBe(400);
  });

  it('"@pixel make it ..." in the chat revises the latest open plan', async () => {
    const v1 = await pitch('@pixel a panda juggling dumplings');
    const n = h.calls.length;
    await h.webhook('message:send', [textEvent(asha.id, channelId, '@pixel make it faster please', ['agentpixel'])]);
    await h.settle();
    const v2 = sends(since(n), CARD_MESSAGE_TYPES.plan).map(c => JSON.parse(String(c.body.content)) as PlanCardContent)[0];
    expect(v2).toMatchObject({ gameId: v1.content.gameId, version: 2 });
  });
});

describe('remix', () => {
  it('"remix Chai Dash into ..." plans a new game linked to the source', async () => {
    const [src] = await h.db.select().from(games).where(eq(games.status, 'building'));
    const r = await pitch(`remix ${src!.title} into a Diwali night version`, asha.id, []);
    expect(r.content.remixOf).toBe(src!.title);
    const [g] = await h.db.select().from(games).where(eq(games.id, r.content.gameId));
    expect(g!.remixOfGameId).toBe(src!.id);
  });
  it('an unknown source gets a friendly message', async () => {
    const n = h.calls.length;
    await h.webhook('message:send', [textEvent(asha.id, channelId, 'remix Nonexistent Game into a space version')]);
    await h.settle();
    const t = sends(since(n), 'RC:TxtMsg').map(c => JSON.parse(String(c.body.content)).content as string);
    expect(t.join(' ')).toMatch(/couldn't find a game called "Nonexistent Game"/);
  });
});

describe('router safety and idempotency', () => {
  it('ignores messages from agents (no loops) and plain chat in a group crew', async () => {
    const n = h.calls.length;
    await h.webhook('message:send', [textEvent('agentpixel', channelId, '@pixel a game about loops', ['agentpixel'])]);
    await h.webhook('message:send', [textEvent(riya.id, channelId, 'who is coming tonight?')]);
    await h.settle();
    expect(since(n).filter(c => c.path !== '/v4/channel-type/message/metadata/set')).toHaveLength(0);
  });

  it('the same messageId never runs twice (webhook retries with a new event id)', async () => {
    const n = h.calls.length;
    const e = textEvent(asha.id, channelId, '@pixel a frog racing lily pads', ['agentpixel'], 'HUMAN-DUP');
    await h.webhook('message:send', [e], 'evt-a');
    await h.webhook('message:send', [e], 'evt-b');
    await h.settle();
    expect(sends(since(n), CARD_MESSAGE_TYPES.plan)).toHaveLength(1);
  });

  it('canned replies for small talk and for Forge/Glitch, without AI', async () => {
    const n = h.calls.length;
    await h.webhook('message:send', [textEvent(asha.id, channelId, '@forge when do you start?', ['agentforge'])]);
    await h.settle();
    const t = sends(since(n), 'RC:TxtMsg')[0]!;
    expect(t.body.fromUserId).toBe('agentforge');
    expect(JSON.parse(String(t.body.content)).content).toMatch(/I build once a plan is approved/);
  });
});

describe('failures', () => {
  it('a refusal becomes "I can\'t make that one" in the chat and a ledger row', async () => {
    const refusing: AiClient = {
      model: 'test',
      structured: () => {
        const ch = channel<string>();
        ch.end();
        const done = Promise.reject(
          new AiRefusalError('general_harms', {
            model: 'test',
            tokensIn: 50,
            tokensOut: 3,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0.0003,
            ms: 120,
            fellBack: false,
          }),
        );
        done.catch(() => {});
        return { fieldChunks: ch.iterable, done };
      },
      streamText: () => {
        throw new Error('unused');
      },
    };
    const r = await createHarness({ agents: true, ai: refusing });
    try {
      const a = await signUp(r, 'Asha', '10.2.0.1');
      const crew = (await r.app.inject({ method: 'POST', url: '/api/crews', headers: { cookie: a.cookie, origin: WEB }, payload: { name: 'Solo' } })).json()
        .crew;
      const n = r.calls.length;
      // Solo crew: no mention needed.
      await r.webhook('message:send', [{ ...textEvent(a.id, crew.groupChannelId, 'a game about something harmful'), time: r.now.t }]);
      await r.settle();
      const t = r.calls.slice(n).filter(c => c.path === '/v4/group-channel/message/send' && c.body.messageType === 'RC:TxtMsg');
      expect(JSON.parse(String(t.at(-1)!.body.content)).content).toBe("I can't make that one 🙈 Try a different idea?");
      const rows = await r.db.select().from(ledger).where(eq(ledger.action, 'plan.refused'));
      expect(rows[0]).toMatchObject({ actorId: 'agent-pixel', tokensIn: 50, reason: 'refusal: general_harms' });
      expect(r.calls.slice(n).some(c => c.body.messageType === CARD_MESSAGE_TYPES.plan)).toBe(false);
    } finally {
      await r.close();
    }
  });

  it('when streaming fails, the reply arrives as one normal text message', async () => {
    h.failNext('/v4/group-channel/message/stream/send', 1002);
    const n = h.calls.length;
    await h.webhook('message:send', [textEvent(asha.id, channelId, '@pixel a mango hopping over trains', ['agentpixel'])]);
    await h.settle();
    const calls = since(n);
    const fallback = sends(calls, 'RC:TxtMsg').map(c => JSON.parse(String(c.body.content)).content as string);
    expect(fallback.some(t => t.includes('Planning *Mango'))).toBe(true);
    expect(sends(calls, CARD_MESSAGE_TYPES.plan)).toHaveLength(1);
  });
});

describe('client relay (backup when webhooks do not arrive)', () => {
  it('routes a sent message like the webhook would; members only; never twice with the webhook', async () => {
    const n = h.calls.length;
    const relay = (cookie: string, messageId: string, text = '@pixel a koala surfing on clouds') =>
      post('/api/chat/relay', cookie, { channelId, messageId, text, mentionedUserIds: ['agentpixel'] });
    expect((await relay(sam.cookie, 'RELAY-0')).statusCode).toBe(200); // Sam joined the crew earlier
    const r = await relay(asha.cookie, 'RELAY-1');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ routed: true });
    // The webhook for the same message arrives later: no second job.
    await h.webhook('message:send', [textEvent(asha.id, channelId, '@pixel a koala surfing on clouds', ['agentpixel'], 'RELAY-1')]);
    await h.settle();
    const plans = sends(since(n), CARD_MESSAGE_TYPES.plan);
    expect(plans).toHaveLength(2); // RELAY-0 and RELAY-1, once each
    const outsider = await signUp(h, 'Zed', '10.1.0.9');
    expect((await relay(outsider.cookie, 'RELAY-2')).statusCode).toBe(404);
    expect((await post('/api/chat/relay', asha.cookie, { channelId, messageId: 'RELAY-3', text: '' })).statusCode).toBe(400);
  });
});

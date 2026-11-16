import { describe, expect, it } from 'vitest';
import {
  AGENTS,
  AGENT_IDS,
  AgentStateMessage,
  CARD_MESSAGE_TYPES,
  CARD_SCHEMAS,
  LIMITS,
  MESSAGE_TYPES,
  MESSAGE_TYPE_REGISTRY,
  META_KEY_RE,
  PreMessagingResponse,
  STATUS_MESSAGE_TYPES,
  WebhookEnvelope,
  applyVote,
  cardKindOf,
  cardPreview,
  decodeCard,
  encodeCard,
  isAgentId,
  isNexconnId,
  metaToStrings,
  newId,
  newInviteCode,
  nexconnUserId,
  parseCardMeta,
  type CardKind,
  type PlanCardContent,
} from '../src';

describe('agents', () => {
  it('uses the fixed agent ids, names and accents', () => {
    expect(AGENT_IDS).toEqual({ pixel: 'agent-pixel', forge: 'agent-forge', glitch: 'agent-glitch' });
    expect(Object.values(AGENTS).map(a => a.displayName)).toEqual(['Pixel · Designer', 'Forge · Builder', 'Glitch · Playtester']);
    expect(Object.values(AGENTS).map(a => a.accent)).toEqual(['violet', 'amber', 'cyan']);
    expect(isAgentId('agent-forge')).toBe(true);
    expect(isAgentId('u123')).toBe(false);
  });
  it('maps every agent to a distinct Nexconn-safe user id', () => {
    const ids = Object.values(AGENT_IDS).map(nexconnUserId);
    expect(ids).toEqual(['agentpixel', 'agentforge', 'agentglitch']);
    expect(ids.every(isNexconnId)).toBe(true);
  });
});

describe('ids', () => {
  it('mints prefixed alphanumeric ids that Nexconn accepts', () => {
    const ids = Array.from({ length: 200 }, () => newId('crewChannel'));
    expect(new Set(ids).size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^crew[A-Za-z0-9]{16}$/);
      expect(isNexconnId(id)).toBe(true);
    }
    expect(newInviteCode()).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
  });
  it('rejects ids Nexconn would refuse', () => {
    expect(isNexconnId('a-b')).toBe(false);
    expect(isNexconnId('x'.repeat(65))).toBe(false);
    expect(() => nexconnUserId('---')).toThrow();
  });
});

describe('message types', () => {
  it('are valid Nexconn custom types and all registered', () => {
    for (const t of Object.values(MESSAGE_TYPES)) {
      expect(t.length).toBeLessThanOrEqual(32);
      expect(t).not.toMatch(/^(RC|NC):/);
    }
    expect(MESSAGE_TYPE_REGISTRY.map(r => r.messageType).sort()).toEqual(Object.values(MESSAGE_TYPES).sort());
    expect(STATUS_MESSAGE_TYPES).toEqual(new Set(['CA:AgentState', 'CA:Reaction', 'CA:Typing']));
  });
});

export const plan: PlanCardContent = {
  v: 1,
  gameId: 'g123',
  version: 1,
  title: 'Chai Dash',
  slug: 'chai-dash',
  pitch: 'A chai cup on a scooter dodging potholes.',
  controls: { keyboard: 'Left/Right arrows steer', touch: 'Tap the left or right buttons' },
  coreLoop: 'Steer between lanes, dodge potholes, collect biscuits.',
  winLose: 'Three potholes and the chai spills: game over.',
  scoring: '+1 per second, +5 per biscuit.',
  lookAndFeel: 'Warm sunset road, steam puffs, bouncy scooter.',
  sound: 'Beep on biscuit, splash on pothole.',
  acceptance: [
    { id: 'A1', text: 'state().score rises while playing.' },
    { id: 'A2', text: 'state().lane changes with ArrowLeft/ArrowRight.' },
    { id: 'A3', text: 'state().lives drops when hitting a pothole.' },
    { id: 'A4', text: 'state().scene is over when lives reach 0.' },
  ],
  language: 'en',
  credits: ['Asha'],
};

describe('cards', () => {
  it('has one registered custom type per card kind', () => {
    for (const t of Object.values(CARD_MESSAGE_TYPES)) {
      expect(Object.values(MESSAGE_TYPES)).toContain(t);
      expect(STATUS_MESSAGE_TYPES.has(t)).toBe(false);
    }
    expect(Object.keys(CARD_SCHEMAS).sort()).toEqual(Object.keys(CARD_MESSAGE_TYPES).sort());
    expect(cardKindOf('CA:PlanCard')).toBe('plan');
    expect(cardKindOf('RC:TxtMsg')).toBeNull();
  });
  it('round-trips through encode/decode and carries a version field', () => {
    const json = encodeCard('plan', plan);
    expect(JSON.parse(json).v).toBe(1);
    expect(decodeCard('CA:PlanCard', json)).toEqual({ kind: 'plan', content: plan });
    expect(decodeCard('CA:PlanCard', JSON.parse(json))).toEqual({ kind: 'plan', content: plan });
  });
  it('rejects invalid content, unknown versions and unknown types', () => {
    expect(() => encodeCard('plan', { ...plan, acceptance: plan.acceptance.slice(0, 3) })).toThrow();
    expect(() => encodeCard('plan', { ...plan, acceptance: [...plan.acceptance, ...plan.acceptance, plan.acceptance[0]!] })).toThrow();
    expect(decodeCard('CA:PlanCard', { ...plan, v: 2 })).toBeNull();
    expect(decodeCard('CA:PlanCard', 'not json')).toBeNull();
    expect(decodeCard('CA:Nope', JSON.stringify(plan))).toBeNull();
    expect(decodeCard('CA:RoomLink', { v: 1, channelId: 'game1', gameId: 'g1', title: 'x', kind: 'tv' })).toBeNull();
  });
  it('validates every card kind and keeps it under the 10 KB limit', () => {
    const samples: { [K in CardKind]: unknown } = {
      plan,
      handoff: {
        v: 1,
        gameId: 'g1',
        from: 'pixel',
        to: 'forge',
        task: 'Build v1 from this plan',
        contextSummary: 'Chai Dash, 4 checks',
        artifacts: [{ kind: 'plan', label: 'Plan v1', ref: 'MSG-1' }],
      },
      build: {
        v: 1,
        gameId: 'g1',
        slug: 'chai-dash',
        title: 'Chai Dash',
        version: 1,
        reason: 'build',
      },
      test: { v: 1, gameId: 'g1', version: 1, pass: false, passed: 3, total: 4, fps: 58, failures: [{ label: 'A2', detail: 'lane stuck' }], regressions: [] },
      publish: { v: 1, gameId: 'g1', version: 1, arcadeUrl: 'https://x.test/g/chai-dash' },
      bug: { v: 1, bugId: 'b1', gameId: 'g1', reporterId: 'u1', description: 'x'.repeat(1000) },
      score: {
        v: 1,
        gameId: 'g1',
        slug: 'chai-dash',
        title: 'Chai Dash',
        version: 1,
        playerId: 'u1',
        playerName: 'Riya',
        score: 120,
        rank: 1,
        beatPlayerId: 'u2',
        beatPlayerName: 'Rohan',
        beatScore: 90,
      },
      roomLink: { v: 1, channelId: 'game1', gameId: 'g1', title: '🎮 Chai Dash', kind: 'game' },
    };
    for (const [kind, sample] of Object.entries(samples) as Array<[CardKind, unknown]>) {
      const json = encodeCard(kind, sample as never);
      expect(json.length).toBeLessThan(LIMITS.messageContentBytes);
      const card = decodeCard(CARD_MESSAGE_TYPES[kind], json);
      expect(card?.kind).toBe(kind);
      expect(cardPreview(card!)).toBeTruthy();
    }
  });
});

describe('card metadata', () => {
  it('parses string metadata into typed state, with safe defaults for missing or broken values', () => {
    expect(parseCardMeta('plan', undefined)).toEqual({ status: 'pending', yes: 0, no: 0, voters: {} });
    const m = parseCardMeta(
      'plan',
      new Map(Object.entries({ status: 'approved', yes: '2', no: '1', voters: '{"u1":"yes","u2":"no","u3":"yes"}', approvedBy: 'Asha' })),
    );
    expect(m).toMatchObject({ status: 'approved', yes: 2, no: 1, approvedBy: 'Asha', voters: { u1: 'yes', u2: 'no', u3: 'yes' } });
    expect(parseCardMeta('plan', { status: 'weird', yes: 'x', voters: '{broken' })).toMatchObject({ status: 'pending', yes: 0, voters: {} });
    expect(parseCardMeta('plan', { voters: '{"u1":"maybe"}' }).voters).toEqual({});
  });
  it('serializes patches to valid Nexconn metadata', () => {
    const out = metaToStrings({ status: 'approved', yes: 2, voters: { u1: 'yes' }, approvedBy: undefined });
    expect(out).toEqual({ status: 'approved', yes: '2', voters: '{"u1":"yes"}' });
    for (const k of Object.keys(out)) expect(k).toMatch(META_KEY_RE);
    expect(() => metaToStrings({ 'bad key': 1 })).toThrow();
    expect(() => metaToStrings({ k: 'x'.repeat(LIMITS.metadataValueChars + 1) })).toThrow();
  });
  it('counts votes: one per voter, switching allowed', () => {
    let r = applyVote({}, 'u1', 'yes');
    r = applyVote(r.voters, 'u2', 'no');
    r = applyVote(r.voters, 'u1', 'yes');
    expect([r.yes, r.no]).toEqual([1, 1]);
    r = applyVote(r.voters, 'u2', 'yes');
    expect([r.yes, r.no]).toEqual([2, 0]);
    // 30 voters still fit in one metadata value.
    let big: Record<string, 'yes' | 'no'> = {};
    for (let i = 0; i < 30; i++) big = applyVote(big, newId('user'), 'yes').voters;
    expect(JSON.stringify(big).length).toBeLessThan(LIMITS.metadataValueChars);
  });
});

describe('agent state', () => {
  it('validates the status message', () => {
    expect(AgentStateMessage.parse({ agentId: 'pixel', state: 'thinking', startedAt: 1 })).toMatchObject({ v: 1, detail: '' });
    expect(AgentStateMessage.safeParse({ agentId: 'pixel', state: 'planning', startedAt: 1 }).success).toBe(false);
    expect(AgentStateMessage.safeParse({ agentId: 'glitch', state: 'testing', startedAt: 1, progress: { done: 12, total: 18 } }).success).toBe(true);
  });
});

describe('webhook schemas', () => {
  it('parses the Nexconn envelope and pre-messaging responses', () => {
    expect(WebhookEnvelope.safeParse({ type: 'message:send', id: 'e1', time: 1, data: [{ userId: 'u1' }] }).success).toBe(true);
    expect(WebhookEnvelope.safeParse({ type: 'message:send', id: 'e1', time: 1 }).success).toBe(false);
    expect(PreMessagingResponse.safeParse({ pass: 0, extra: 'blocked' }).success).toBe(true);
    expect(PreMessagingResponse.safeParse({ pass: 3 }).success).toBe(false);
  });
});

describe('game host messages (score hook)', () => {
  it('accepts exactly the two engine messages and nothing else', async () => {
    const { parseGameHostMessage } = await import('../src/play');
    expect(parseGameHostMessage({ type: 'crewarcade:start' })).toEqual({ type: 'crewarcade:start' });
    expect(parseGameHostMessage({ type: 'crewarcade:score', score: 120, best: 300, time: 41.5 })).toEqual({
      type: 'crewarcade:score',
      score: 120,
      best: 300,
      time: 41.5,
    });
    for (const bad of [
      null,
      'crewarcade:start',
      { type: 'crewarcade:score', score: -1, best: 0, time: 1 },
      { type: 'crewarcade:score', score: 1.5, best: 0, time: 1 },
      { type: 'crewarcade:score', score: 1, best: 0, time: Infinity },
      { type: 'crewarcade:score', score: 1, best: 0 },
      { type: 'crewarcade:score', score: 1, best: 0, time: 1, extra: 'x' },
      { type: 'crewarcade:start', score: 1 },
      { type: 'crewarcade:navigate', url: 'https://evil.test' },
    ])
      expect(parseGameHostMessage(bad)).toBeNull();
  });

  it('score and remix bodies are validated', async () => {
    const { ScoreBody, RemixBody } = await import('../src/play');
    expect(ScoreBody.safeParse({ gameId: 'g1', version: 1, score: 10, timeMs: 5000 }).success).toBe(true);
    expect(ScoreBody.safeParse({ gameId: 'g1', version: 0, score: 10, timeMs: 5000 }).success).toBe(false);
    expect(ScoreBody.safeParse({ gameId: 'g1', version: 1, score: -5, timeMs: 5000 }).success).toBe(false);
    expect(RemixBody.safeParse({ newCrewName: 'Remixers' }).success).toBe(true);
    expect(RemixBody.safeParse({}).success).toBe(false);
    expect(RemixBody.safeParse({ crewId: 'c1', newCrewName: 'x' }).success).toBe(false);
  });
});

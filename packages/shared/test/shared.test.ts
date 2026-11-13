import { describe, expect, it } from 'vitest';
import {
  AGENTS,
  AGENT_IDS,
  CARD_TYPES,
  LIMITS,
  MESSAGE_TYPES,
  MESSAGE_TYPE_REGISTRY,
  META,
  META_KEY_RE,
  PreMessagingResponse,
  WebhookEnvelope,
  decodeCard,
  encodeCard,
  isAgentId,
  isNexconnId,
  newId,
  newInviteCode,
  nexconnUserId,
  tallyVotes,
  type CardPayload,
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
  });
});

describe('cards', () => {
  const plan: CardPayload = {
    card: 'plan',
    gameId: 'g123',
    title: 'Penguin Slide',
    pitch: 'A penguin slides down an icy hill dodging snowmen.',
    highlights: ['Arrow keys or on-screen buttons', '+1 per second, +10 per fish'],
    acceptance: [
      { id: 'A1', text: 'Score increases while playing.' },
      { id: 'A2', text: 'Speed rises with time.' },
      { id: 'A3', text: 'A snowman ends the run.' },
      { id: 'A4', text: 'reset() returns to the title.' },
    ],
    credits: ['Asha'],
    quorum: 2,
  };

  it('round-trips through encode/decode', () => {
    const json = encodeCard(plan);
    expect(decodeCard(json)).toEqual({ v: 1, payload: plan });
    expect(decodeCard(JSON.parse(json))).toEqual({ v: 1, payload: plan });
  });
  it('rejects invalid or unknown cards', () => {
    expect(() => encodeCard({ ...plan, acceptance: [] } as CardPayload)).toThrow();
    expect(decodeCard('{"v":1,"payload":{"card":"nope"}}')).toBeNull();
    expect(decodeCard('not json')).toBeNull();
    expect(decodeCard({ v: 2, payload: plan })).toBeNull();
  });
  it('keeps content under the Nexconn 10 KB limit', () => {
    const big = { card: 'bug_report', gameId: 'g1', bugId: 'b1', version: 1, description: 'x'.repeat(1000) } as const;
    expect(encodeCard(big).length).toBeLessThan(LIMITS.messageContentBytes);
  });
  it('lists every card type once', () => {
    expect(new Set(CARD_TYPES).size).toBe(CARD_TYPES.length);
    expect(CARD_TYPES).toEqual(expect.arrayContaining(['plan', 'handoff', 'playtest', 'publish_request', 'shield']));
  });
});

describe('metadata', () => {
  it('builds valid keys and tallies votes', () => {
    const key = META.vote(newId('user'));
    expect(key).toMatch(META_KEY_RE);
    expect(tallyVotes({ vote_u1: 'yes', vote_u2: 'no', vote_u3: 'yes', status: 'voting' })).toEqual({ yes: ['u1', 'u3'], no: ['u2'] });
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

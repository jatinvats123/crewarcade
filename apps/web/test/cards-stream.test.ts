// Phase 2 client logic: card/stream normalization, metadata and stream reducer actions, agent
// states with expiry, optimistic votes, and the safe Markdown subset.
import { encodeCard, parseCardMeta, type AgentStateMessage } from '@crewarcade/shared';
import { describe, expect, it } from 'vitest';
import { elapsed, optimisticVote, planStatusLabel } from '@/lib/cards';
import { parseInline, parseMarkdown } from '@/lib/chat/markdown';
import { normalizeMessage, parseStreamContent, previewText, type SdkMessageLike } from '@/lib/chat/normalize';
import { AGENT_STATE_TTL_MS, chatReducer, roomAgentStates } from '@/lib/chat/reducer';
import { initialChatState } from '@/lib/chat/types';

const sdk = (o: Partial<SdkMessageLike>): SdkMessageLike => ({
  messageId: 'M1',
  messageType: 'RC:TxtMsg',
  content: {},
  senderUserId: 'agentpixel',
  sentTime: 1000,
  channelIdentifier: { channelId: 'crew1' },
  direction: 2,
  ...o,
});

const roomLink = encodeCard('roomLink', { v: 1, channelId: 'game1', gameId: 'g1', title: '🎮 Chai Dash', kind: 'game' });

describe('normalize cards and streams', () => {
  it('decodes a card with its metadata (Map from the SDK)', () => {
    const m = normalizeMessage(sdk({ messageType: 'CA:RoomLink', content: roomLink, metadata: new Map([['x', '1']]) }), 'me');
    expect(m).toMatchObject({ kind: 'card', card: { kind: 'roomLink', content: { channelId: 'game1' } }, meta: { x: '1' } });
    expect(previewText(m)).toBe('🎮 🎮 Chai Dash');
  });
  it('keeps unknown or invalid card content as a card with no body (renders a fallback)', () => {
    const m = normalizeMessage(sdk({ messageType: 'CA:PlanCard', content: '{"v":9}' }), 'me');
    expect(m).toMatchObject({ kind: 'card', card: null });
  });
  it('reads RC:StreamMsg content (isCompleted on Web, complete on the wire)', () => {
    expect(parseStreamContent({ content: 'Ooh', isCompleted: false })).toEqual({ text: 'Ooh', complete: false });
    expect(parseStreamContent('{"content":"done","complete":true}')).toEqual({ text: 'done', complete: true });
    expect(parseStreamContent({ nope: 1 })).toBeNull();
    const m = normalizeMessage(sdk({ messageType: 'RC:StreamMsg', content: { content: 'Ooh, *Chai*', isCompleted: false } }), 'me');
    expect(m).toMatchObject({ kind: 'stream', text: 'Ooh, *Chai*', streamComplete: false });
    expect(previewText(m)).toBe('Ooh, Chai');
  });
});

describe('reducer: metadata, streams, agent states', () => {
  const withMsgs = () => {
    let s = chatReducer(initialChatState, {
      type: 'history/loaded',
      channelId: 'crew1',
      hasMore: false,
      messages: [
        normalizeMessage(sdk({ messageType: 'CA:RoomLink', content: roomLink, metadata: { status: 'pending', yes: '0' } }), 'me'),
        normalizeMessage(sdk({ messageId: 'S1', sentTime: 2000, messageType: 'RC:StreamMsg', content: { content: 'Oo', isCompleted: false } }), 'me'),
      ],
    });
    s = chatReducer(s, { type: 'history/loaded', channelId: 'game1', hasMore: false, messages: [] });
    return s;
  };

  it('metadata updates merge into the card (or replace it on rollback)', () => {
    let s = chatReducer(withMsgs(), { type: 'message/metadata', channelId: 'crew1', messageId: 'M1', metadata: { yes: '1' } });
    expect(s.channels.crew1!.messages[0]!.meta).toEqual({ status: 'pending', yes: '1' });
    s = chatReducer(s, { type: 'message/metadata', channelId: 'crew1', messageId: 'M1', metadata: { yes: '0' }, replace: true });
    expect(s.channels.crew1!.messages[0]!.meta).toEqual({ yes: '0' });
    expect(chatReducer(s, { type: 'message/metadata', channelId: 'crew1', messageId: 'NOPE', metadata: {} })).toBe(s);
  });

  it('stream deltas find their channel by messageId, only grow, and complete', () => {
    let s = chatReducer(withMsgs(), { type: 'stream/delta', messageId: 'S1', text: 'Ooh, I love' });
    expect(s.channels.crew1!.messages[1]).toMatchObject({ text: 'Ooh, I love', streamComplete: false });
    s = chatReducer(s, { type: 'stream/delta', messageId: 'S1', text: 'Ooh' }); // late, shorter delta
    expect(s.channels.crew1!.messages[1]!.text).toBe('Ooh, I love');
    s = chatReducer(s, { type: 'stream/complete', messageId: 'S1' });
    expect(s.channels.crew1!.messages[1]!.streamComplete).toBe(true);
    expect(chatReducer(s, { type: 'stream/delta', messageId: 'UNKNOWN', text: 'x' })).toBe(s);
    // A history reload with the final text keeps it complete.
    s = chatReducer(s, {
      type: 'history/loaded',
      channelId: 'crew1',
      hasMore: false,
      messages: [
        normalizeMessage(
          sdk({ messageId: 'S1', sentTime: 2000, messageType: 'RC:StreamMsg', content: { content: 'Ooh, I love this!', isCompleted: true } }),
          'me',
        ),
      ],
    });
    expect(s.channels.crew1!.messages[1]).toMatchObject({ text: 'Ooh, I love this!', streamComplete: true });
  });

  it('agent states: set, idle clears, busy states expire without a heartbeat, waiting ones stay', () => {
    const st = (agentId: AgentStateMessage['agentId'], state: AgentStateMessage['state']): AgentStateMessage => ({
      v: 1,
      agentId,
      state,
      detail: '',
      startedAt: 0,
    });
    let s = chatReducer(initialChatState, { type: 'agent/state', channelId: 'r', state: st('pixel', 'thinking'), receivedAt: 0 });
    s = chatReducer(s, { type: 'agent/state', channelId: 'r', state: st('forge', 'waiting_approval'), receivedAt: 0 });
    s = chatReducer(s, { type: 'agent/state', channelId: 'r', state: st('glitch', 'testing'), receivedAt: 10_000 });
    expect(roomAgentStates(s.channels.r).map(x => x.agentId)).toEqual(['pixel', 'forge', 'glitch']);
    s = chatReducer(s, { type: 'agent/expire', now: AGENT_STATE_TTL_MS + 1 });
    expect(roomAgentStates(s.channels.r).map(x => `${x.agentId}:${x.state}`)).toEqual(['forge:waiting_approval', 'glitch:testing']);
    s = chatReducer(s, { type: 'agent/state', channelId: 'r', state: st('glitch', 'idle'), receivedAt: 20_000 });
    expect(Object.keys(s.channels.r!.agentStates)).toEqual(['forge']);
    expect(chatReducer(s, { type: 'agent/expire', now: 20_000 })).toBe(s);
  });
});

describe('cards: optimistic votes and labels', () => {
  it('counts my vote at once, one per person, switching moves it', () => {
    const start = { status: 'pending', yes: '1', no: '0', voters: '{"u2":"yes"}' };
    const a = optimisticVote(start, 'me', 'yes');
    expect(parseCardMeta('plan', a)).toMatchObject({ yes: 2, no: 0 });
    const b = optimisticVote(a, 'me', 'no');
    expect(parseCardMeta('plan', b)).toMatchObject({ yes: 1, no: 1, voters: { u2: 'yes', me: 'no' } });
    expect(b.status).toBe('pending');
  });
  it('labels every plan status', () => {
    expect(planStatusLabel(parseCardMeta('plan', { status: 'approved', approvedBy: 'Asha' })).text).toBe('Approved by Asha');
    expect(planStatusLabel(parseCardMeta('plan', { status: 'superseded' })).text).toMatch(/newer plan/);
    expect(planStatusLabel(parseCardMeta('plan', {})).text).toMatch(/approver decides/);
    expect([elapsed(32_400), elapsed(65_000)]).toEqual(['32s', '1:05']);
  });
});

describe('markdown (safe subset)', () => {
  it('parses inline marks and leaves unclosed ones as text (mid-stream)', () => {
    expect(parseInline('Ooh, planning *Chai Dash*!')).toEqual([
      { t: 'text', v: 'Ooh, planning ' },
      { t: 'em', c: [{ t: 'text', v: 'Chai Dash' }] },
      { t: 'text', v: '!' },
    ]);
    expect(parseInline('**bold** and `code`')).toEqual([
      { t: 'strong', c: [{ t: 'text', v: 'bold' }] },
      { t: 'text', v: ' and ' },
      { t: 'code', v: 'code' },
    ]);
    expect(parseInline('Planning *Chai')).toEqual([{ t: 'text', v: 'Planning *Chai' }]);
    expect(parseInline('snake_case_name stays')).toEqual([{ t: 'text', v: 'snake_case_name stays' }]);
    expect(parseInline('2 * 3 * 4')).toEqual([{ t: 'text', v: '2 * 3 * 4' }]);
  });
  it('turns http(s) URLs into links and never anything else', () => {
    expect(parseInline('see https://x.test/a.')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'link', href: 'https://x.test/a', v: 'https://x.test/a' },
      { t: 'text', v: '.' },
    ]);
    const evil = parseInline('[x](javascript:alert(1)) <img src=x onerror=alert(1)>');
    expect(evil.every(n => n.t === 'text')).toBe(true);
  });
  it('parses blocks: paragraphs with line breaks, headings, lists', () => {
    expect(parseMarkdown('# Title\nline one\nline two\n\n- a\n- b\n1. c')).toEqual([
      { t: 'h', c: [{ t: 'text', v: 'Title' }] },
      { t: 'p', lines: [[{ t: 'text', v: 'line one' }], [{ t: 'text', v: 'line two' }]] },
      { t: 'ul', items: [[{ t: 'text', v: 'a' }], [{ t: 'text', v: 'b' }]] },
      { t: 'ol', items: [[{ t: 'text', v: 'c' }]] },
    ]);
    expect(parseMarkdown('')).toEqual([]);
  });
});

// Normalization of SDK messages, timeline grouping, linkify and @mentions.
import { describe, expect, it } from 'vitest';
import { dayLabel, groupTimeline, localDay } from '@/lib/chat/grouping';
import { formatDuration, normalizeMessage, previewText, streamSummary, type SdkMessageLike } from '@/lib/chat/normalize';
import { insertMention, mentionCandidates, mentionQuery, resolveMentions, tokenize, type MentionTarget } from '@/lib/chat/text';
import type { ChatMessage } from '@/lib/chat/types';

const sdk = (over: Partial<SdkMessageLike>): SdkMessageLike => ({
  messageId: 'M1',
  messageType: 'RC:TxtMsg',
  content: { text: 'hello' },
  senderUserId: 'uFriend',
  sentTime: 1000,
  channelIdentifier: { channelId: 'crew1' },
  direction: 2,
  sentStatus: 30,
  needReceipt: true,
  sentReceipt: false,
  ...over,
});

describe('normalizeMessage', () => {
  it('text (SDK and server wire format), with mentions', () => {
    expect(normalizeMessage(sdk({ content: { text: '@pixel hi', mentionedInfo: { type: 2, userIdList: ['agentpixel'] } } }), 'uMe')).toMatchObject({
      kind: 'text',
      text: '@pixel hi',
      mentionedUserIds: ['agentpixel'],
      direction: 'in',
      needReceipt: true,
    });
    expect(normalizeMessage(sdk({ content: '{"content":"Hi crew!"}', senderUserId: 'agentpixel' }), 'uMe').text).toBe('Hi crew!');
  });
  it('own messages are outgoing', () => {
    expect(normalizeMessage(sdk({ senderUserId: 'uMe', direction: 1 }), 'uMe').direction).toBe('out');
  });
  it('image, voice, notice, card and unknown types', () => {
    expect(normalizeMessage(sdk({ messageType: 'RC:ImgMsg', content: { remoteUrl: 'https://x/i.jpg', thumbnailBase64: 'QUJD' } }), 'uMe')).toMatchObject({
      kind: 'image',
      image: { url: 'https://x/i.jpg', thumb: 'data:image/jpeg;base64,QUJD' },
    });
    expect(normalizeMessage(sdk({ messageType: 'RC:HQVCMsg', content: { remoteUrl: 'https://x/v.webm', duration: 7 } }), 'uMe').voice).toEqual({
      url: 'https://x/v.webm',
      durationS: 7,
    });
    expect(normalizeMessage(sdk({ messageType: 'CA:Notice', content: '{"kind":"member_joined","text":"Riya joined the crew"}' }), 'uMe')).toMatchObject({
      kind: 'notice',
      notice: { kind: 'member_joined', text: 'Riya joined the crew' },
    });
    expect(
      normalizeMessage(
        sdk({
          messageType: 'CA:ScoreCard',
          content: '{"v":1,"gameId":"g1","slug":"chai-dash","title":"Chai Dash","version":1,"playerId":"u1","playerName":"Riya","score":12,"rank":1}',
        }),
        'uMe',
      ),
    ).toMatchObject({
      kind: 'card',
      card: { kind: 'score', content: { score: 12 } },
    });
    expect(normalizeMessage(sdk({ messageType: 'CA:ScoreCard', content: '{"v":9}' }), 'uMe')).toMatchObject({ kind: 'card', card: null });
    // The Phase 1 envelope type is gone: old clients' CA:Card is just unknown now.
    expect(normalizeMessage(sdk({ messageType: 'CA:Card', content: '{}' }), 'uMe').kind).toBe('unknown');
    expect(normalizeMessage(sdk({ messageType: 'RC:LBSMsg', content: {} }), 'uMe').kind).toBe('unknown');
    // A malicious image URL degrades to the fallback instead of rendering.
    expect(normalizeMessage(sdk({ messageType: 'RC:ImgMsg', content: { remoteUrl: 'javascript:alert(1)' } }), 'uMe').kind).toBe('unknown');
  });
  it('previews and durations', () => {
    expect(previewText(normalizeMessage(sdk({ messageType: 'RC:HQVCMsg', content: { remoteUrl: 'https://x/v', duration: 65 } }), 'uMe'))).toBe(
      '🎙️ Voice note (1:05)',
    );
    expect(formatDuration(0)).toBe('0:00');
  });
});

describe('groupTimeline', () => {
  const m = (senderId: string, t: number, kind: ChatMessage['kind'] = 'text'): ChatMessage => ({
    ...normalizeMessage(sdk({ messageId: `${senderId}${t}`, senderUserId: senderId, sentTime: t }), 'uMe'),
    kind,
  });
  it('groups consecutive messages by sender within 5 minutes, splits by day and around notices', () => {
    const day1 = new Date(2026, 10, 12, 10, 0).getTime();
    const day2 = new Date(2026, 10, 13, 9, 0).getTime();
    const blocks = groupTimeline([
      m('a', day1),
      m('a', day1 + 60_000),
      m('a', day1 + 7 * 60_000),
      m('b', day1 + 8 * 60_000),
      m('x', day1 + 9 * 60_000, 'notice'),
      m('b', day1 + 9.5 * 60_000),
      m('b', day2),
    ]);
    expect(blocks.map(b => b.day)).toEqual([localDay(day1), localDay(day2)]);
    expect(blocks[0]!.items.map(i => (i.type === 'group' ? `${i.group.senderId}${i.group.messages.length}` : 'notice'))).toEqual([
      'a2',
      'a1',
      'b1',
      'notice',
      'b1',
    ]);
  });
  it('labels days', () => {
    const now = new Date(2026, 10, 13, 12).getTime();
    expect(dayLabel(localDay(now), now)).toBe('Today');
    expect(dayLabel(localDay(now - 86_400_000), now)).toBe('Yesterday');
  });
});

describe('text: links and mentions', () => {
  const targets: MentionTarget[] = [
    { userId: 'agentpixel', handle: 'pixel', label: 'Pixel · Designer', isAgent: true },
    { userId: 'uSam', handle: 'Sam', label: 'Sam', isAgent: false },
    { userId: 'uSamK', handle: 'Sam K', label: 'Sam K', isAgent: false },
  ];
  it('linkifies http(s) only and trims trailing punctuation', () => {
    expect(tokenize('see https://example.com/a?b=1. and javascript:alert(1)')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', value: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { type: 'text', value: '. and javascript:alert(1)' },
    ]);
  });
  it('highlights whole-word mentions, longest handle first, case-insensitive', () => {
    const segs = tokenize('@Pixel make it with @Sam K, not @Samuel or email@pixel', targets);
    expect(segs.filter(s => s.type === 'mention')).toEqual([
      { type: 'mention', value: '@Pixel', userId: 'agentpixel' },
      { type: 'mention', value: '@Sam K', userId: 'uSamK' },
    ]);
    expect(segs.map(s => s.value).join('')).toBe('@Pixel make it with @Sam K, not @Samuel or email@pixel');
  });
  it('resolves mentionedInfo.userIdList from the text', () => {
    expect(resolveMentions('hey @pixel and @Sam!', targets).sort()).toEqual(['agentpixel', 'uSam']);
    expect(resolveMentions('no mentions here, pixel', targets)).toEqual([]);
  });
  it('finds the @query at the caret and inserts the handle', () => {
    expect(mentionQuery('hello @pi', 9)).toEqual({ query: 'pi', start: 6 });
    expect(mentionQuery('@', 1)).toEqual({ query: '', start: 0 });
    expect(mentionQuery('mail@pi', 7)).toBeNull();
    expect(mentionQuery('hello @pi there', 15)).toBeNull();
    expect(insertMention('hello @pi', 6, 9, 'pixel')).toEqual({ text: 'hello @pixel ', caret: 13 });
  });
  it('ranks candidates: prefix before substring, agents first', () => {
    expect(mentionCandidates('', targets).map(t => t.userId)).toEqual(['agentpixel', 'uSam', 'uSamK']);
    expect(mentionCandidates('k', targets).map(t => t.userId)).toEqual(['uSamK']);
    expect(mentionCandidates('des', targets).map(t => t.userId)).toEqual(['agentpixel']);
  });
});

describe('stream summaries (Nexconn RC_Ext_StreamMsgSummary)', () => {
  it('reads the final text from metadata, as an object or a Map', () => {
    const v = JSON.stringify({ complete: true, summary: 'A part one, A part two.' });
    expect(streamSummary({ RC_Ext_StreamMsgSummary: v })).toEqual({ text: 'A part one, A part two.', complete: true });
    expect(streamSummary(new Map([['RC_Ext_StreamMsgSummary', v]]))).toEqual({ text: 'A part one, A part two.', complete: true });
    expect(streamSummary({ status: 'ready' })).toBeNull();
    expect(streamSummary({ RC_Ext_StreamMsgSummary: 'not json' })).toBeNull();
    expect(streamSummary(null)).toBeNull();
  });

  it('prefers the summary over the stored first chunk', () => {
    const m = normalizeMessage(
      sdk({
        messageType: 'RC:StreamMsg',
        content: { content: 'A part one, ', isCompleted: false },
        metadata: { RC_Ext_StreamMsgSummary: JSON.stringify({ complete: true, summary: 'A part one, A part two.' }) },
      }),
      'uMe',
    );
    expect(m).toMatchObject({ kind: 'stream', text: 'A part one, A part two.', streamComplete: true });
  });
});

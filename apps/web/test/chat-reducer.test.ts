// Client-side message reducer: ordering, dedupe, optimistic sends, receipts, typing, unread.
import { describe, expect, it } from 'vitest';
import { chatReducer, mergeMessages, typingUserIds, type ChatAction } from '@/lib/chat/reducer';
import { initialChatState, type ChatMessage, type ChatState } from '@/lib/chat/types';

const CH = 'crewAAAA';
let seq = 0;
function msg(over: Partial<ChatMessage> = {}): ChatMessage {
  const id = over.messageId === undefined ? `M${++seq}` : over.messageId;
  return {
    key: id ?? `local:${over.localId}`,
    messageId: id,
    localId: null,
    channelId: CH,
    senderId: 'uFriend',
    sentTime: 1000 + seq,
    kind: 'text',
    rawType: 'RC:TxtMsg',
    text: 'hi',
    direction: 'in',
    status: 'sent',
    needReceipt: true,
    receiptSent: false,
    ...over,
  };
}
const run = (actions: ChatAction[], s: ChatState = initialChatState) => actions.reduce(chatReducer, s);
const timeline = (s: ChatState) => s.channels[CH]!.messages;

describe('ordering', () => {
  it('keeps messages sorted by server time whatever order they arrive in', () => {
    const a = msg({ sentTime: 300 });
    const b = msg({ sentTime: 100 });
    const c = msg({ sentTime: 200 });
    const s = run([
      { type: 'message/received', message: a, active: true },
      { type: 'history/loaded', channelId: CH, messages: [b], hasMore: true },
      { type: 'message/received', message: c, active: true },
    ]);
    expect(timeline(s).map(m => m.sentTime)).toEqual([100, 200, 300]);
  });
  it('breaks time ties deterministically', () => {
    const x = msg({ messageId: 'B', key: 'B', sentTime: 5 });
    const y = msg({ messageId: 'A', key: 'A', sentTime: 5 });
    expect(mergeMessages([], [x, y]).map(m => m.messageId)).toEqual(['A', 'B']);
  });
  it('older history pages merge in front', () => {
    const live = [msg({ sentTime: 500 }), msg({ sentTime: 600 })];
    const older = [msg({ sentTime: 100 }), msg({ sentTime: 200 })];
    const s = run([
      { type: 'history/loaded', channelId: CH, messages: live, hasMore: true },
      { type: 'history/loaded', channelId: CH, messages: older, hasMore: false },
    ]);
    expect(timeline(s).map(m => m.sentTime)).toEqual([100, 200, 500, 600]);
    expect(s.channels[CH]!.hasMore).toBe(false);
  });
});

describe('dedupe', () => {
  it('the same messageId from history, live delivery and offline sync appears once', () => {
    const m = msg({ sentTime: 10 });
    const s = run([
      { type: 'message/received', message: m, active: false },
      { type: 'history/loaded', channelId: CH, messages: [m], hasMore: false },
      { type: 'message/received', message: { ...m }, active: false },
    ]);
    expect(timeline(s)).toHaveLength(1);
    expect(s.channels[CH]!.unread).toBe(1);
  });
  it('does not lose local knowledge when the server copy replaces ours', () => {
    const m = msg({ receiptSent: true, readCount: 2, totalCount: 5 });
    const s = run([
      { type: 'message/received', message: m, active: true },
      { type: 'message/received', message: { ...m, receiptSent: false, readCount: 1 }, active: true },
    ]);
    expect(timeline(s)[0]).toMatchObject({ receiptSent: true, readCount: 2 });
  });
});

describe('optimistic sends', () => {
  const local = (localId: string, over: Partial<ChatMessage> = {}) =>
    msg({ messageId: null, key: `local:${localId}`, localId, senderId: 'uMe', direction: 'out', status: 'sending', sentTime: 9_999, ...over });

  it('shows the message at once, then swaps in the server id and time without changing the React key', () => {
    const s1 = run([{ type: 'message/optimistic', message: local('L1') }]);
    expect(timeline(s1)[0]).toMatchObject({ status: 'sending', key: 'local:L1', messageId: null });
    const s2 = chatReducer(s1, {
      type: 'message/sent',
      channelId: CH,
      localId: 'L1',
      message: msg({ messageId: 'SRV1', senderId: 'uMe', direction: 'out', sentTime: 5000 }),
    });
    expect(timeline(s2)).toHaveLength(1);
    expect(timeline(s2)[0]).toMatchObject({ key: 'local:L1', messageId: 'SRV1', sentTime: 5000, status: 'sent', localId: 'L1' });
  });

  it('a sync echo that beats the send result is merged, not duplicated', () => {
    const echo = msg({ messageId: 'SRV2', senderId: 'uMe', direction: 'out', sentTime: 5000 });
    const s = run([
      { type: 'message/optimistic', message: local('L2') },
      { type: 'message/received', message: echo, active: true },
      { type: 'message/sent', channelId: CH, localId: 'L2', message: echo },
    ]);
    expect(timeline(s)).toHaveLength(1);
    expect(timeline(s)[0]).toMatchObject({ key: 'local:L2', messageId: 'SRV2', status: 'sent' });
  });

  it('failed sends keep their place, show the error and can be retried', () => {
    const s = run([
      { type: 'message/optimistic', message: local('L3') },
      { type: 'message/progress', channelId: CH, localId: 'L3', progress: 40 },
      { type: 'message/failed', channelId: CH, localId: 'L3', errorCode: 30004 },
    ]);
    expect(timeline(s)[0]).toMatchObject({ status: 'failed', errorCode: 30004, progress: undefined });
    const r = chatReducer(s, { type: 'message/retry', channelId: CH, localId: 'L3' });
    expect(timeline(r)[0]).toMatchObject({ status: 'sending', errorCode: undefined });
  });

  it('optimistic messages update the crew list preview; own messages never count as unread', () => {
    const s = run([{ type: 'message/optimistic', message: local('L4', { text: 'yo' }) }]);
    expect(s.channels[CH]!.preview?.text).toBe('yo');
    expect(s.channels[CH]!.unread).toBe(0);
  });
});

describe('unread, receipts, typing, blocks', () => {
  it('counts unread only for inactive channels and counted kinds', () => {
    const s = run([
      { type: 'message/received', message: msg(), active: false },
      { type: 'message/received', message: msg({ kind: 'notice', rawType: 'CA:Notice' }), active: false },
      { type: 'message/received', message: msg(), active: true },
    ]);
    expect(s.channels[CH]!.unread).toBe(1);
    expect(chatReducer(s, { type: 'unread/set', channelId: CH, count: 0 }).channels[CH]!.unread).toBe(0);
  });

  it('read counts only go up', () => {
    const m = msg({ messageId: 'R1', senderId: 'uMe', direction: 'out' });
    const s = run([
      { type: 'message/received', message: m, active: true },
      { type: 'receipts/updated', channelId: CH, receipts: [{ messageId: 'R1', readCount: 2, totalCount: 5 }] },
      { type: 'receipts/updated', channelId: CH, receipts: [{ messageId: 'R1', readCount: 1, totalCount: 5 }] },
    ]);
    expect(timeline(s)[0]).toMatchObject({ readCount: 2, totalCount: 5 });
  });

  it('marks receipts as sent', () => {
    const m = msg({ messageId: 'R2' });
    const s = run([
      { type: 'message/received', message: m, active: true },
      { type: 'receipts/sent', channelId: CH, messageIds: ['R2'] },
    ]);
    expect(timeline(s)[0]!.receiptSent).toBe(true);
  });

  it('typing indicators expire, and a message from the typist clears theirs', () => {
    const s = run([
      { type: 'typing/started', channelId: CH, userId: 'uRiya', until: 2000 },
      { type: 'typing/started', channelId: CH, userId: 'uSam', until: 5000 },
      { type: 'typing/started', channelId: CH, userId: 'uMe', until: 5000 },
    ]);
    expect(typingUserIds(s.channels[CH], 'uMe', 1000)).toEqual(['uRiya', 'uSam']);
    const later = chatReducer(s, { type: 'typing/expire', now: 3000 });
    expect(typingUserIds(later.channels[CH], 'uMe', 3000)).toEqual(['uSam']);
    const sent = chatReducer(later, { type: 'message/received', message: msg({ senderId: 'uSam' }), active: true });
    expect(typingUserIds(sent.channels[CH], 'uMe', 3000)).toEqual([]);
    expect(chatReducer(sent, { type: 'typing/expire', now: 3000 })).toBe(sent); // no change, same object
  });

  it('records a blocked message with the server-provided reason', () => {
    const m = msg({ messageId: 'B1', senderId: 'uMe', direction: 'out' });
    const s = run([
      { type: 'message/received', message: m, active: true },
      { type: 'message/blocked', channelId: CH, messageId: 'B1', reason: 'That looked like an API key, so it was not sent.' },
    ]);
    expect(timeline(s)[0]!.blockedReason).toMatch(/API key/);
  });

  it('removes deleted messages', () => {
    const m = msg({ messageId: 'D1' });
    const s = run([
      { type: 'message/received', message: m, active: true },
      { type: 'message/deleted', channelId: CH, messageIds: ['D1'] },
    ]);
    expect(timeline(s)).toEqual([]);
  });
});

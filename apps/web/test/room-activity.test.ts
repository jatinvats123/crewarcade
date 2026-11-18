// The side panel's game status follows the room: its signature changes when a card arrives or
// changes state, or an agent posts; plain human chat does not trigger a refresh.
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/lib/chat/types';
import { roomActivitySignature } from '../src/lib/room';

type M = Pick<ChatMessage, 'kind' | 'messageId' | 'senderId' | 'meta' | 'card'>;
const build = (status: string): M => ({
  kind: 'card',
  messageId: 'B1',
  senderId: 'agentforge',
  meta: { status },
  card: { kind: 'build', content: { v: 1, gameId: 'g', slug: 'chai-paws', title: 'Chai Paws', version: 1, reason: 'build' } },
});
const text = (senderId: string): M => ({ kind: 'text', messageId: `t-${senderId}`, senderId });

describe('room activity signature', () => {
  it('changes when a card changes state or an agent posts, not for human chat', () => {
    const building = roomActivitySignature([build('building')]);
    const ready = roomActivitySignature([build('ready')]);
    expect(ready).not.toBe(building);
    const glitchPosted = roomActivitySignature([build('ready'), text('agentglitch')]);
    expect(glitchPosted).not.toBe(ready);
    expect(roomActivitySignature([build('ready'), text('agentglitch'), text('u123')])).toBe(glitchPosted);
  });
});

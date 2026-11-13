// SDK message -> ChatMessage. Takes a structural subset of @nexconn/chat's Message (verified against
// node_modules/@nexconn/chat/index.d.ts, v26.2.1) so it stays pure and testable without the SDK.
// Content is untrusted: every shape goes through the zod parsers in @crewarcade/shared.
import {
  BUILTIN_MESSAGE_TYPES,
  cardPreview,
  decodeCard,
  isCardType,
  MESSAGE_TYPES,
  NoticeMessage,
  asObject,
  parseImageContent,
  parseTextContent,
  parseVoiceContent,
} from '@crewarcade/shared';
import type { ChatMessage } from './types';

export interface SdkMessageLike {
  messageId: string;
  messageType: string;
  content: unknown;
  senderUserId: string;
  sentTime: number;
  channelIdentifier: { channelId: string };
  /** MessageDirection: 1 SEND, 2 RECEIVE. */
  direction: number;
  /** SentStatus: 10 SENDING, 20 FAILED, 30 SENT, 50 READ. */
  sentStatus?: number;
  needReceipt?: boolean;
  sentReceipt?: boolean;
  /** Nexconn message metadata (a Map in the SDK). */
  metadata?: Map<string, string> | Record<string, string> | null;
}

/** RC:StreamMsg content as the Web SDK exposes it (StreamMessageContent: content + isCompleted). */
export function parseStreamContent(content: unknown): { text: string; complete: boolean } | null {
  const o = asObject(content);
  if (!o || typeof o !== 'object') return null;
  const c = o as { content?: unknown; isCompleted?: unknown; complete?: unknown };
  if (typeof c.content !== 'string') return null;
  return { text: c.content, complete: c.isCompleted === true || c.complete === true };
}

const metaRecord = (m: SdkMessageLike['metadata']): Record<string, string> => {
  if (!m) return {};
  const entries = m instanceof Map ? [...m.entries()] : Object.entries(m);
  return Object.fromEntries(entries.filter((e): e is [string, string] => typeof e[1] === 'string'));
};

export function normalizeMessage(m: SdkMessageLike, myUserId: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  const out = m.senderUserId === myUserId || m.direction === 1;
  const base: ChatMessage = {
    key: m.messageId || `local:${extra.localId ?? Math.random().toString(36).slice(2)}`,
    messageId: m.messageId || null,
    localId: null,
    channelId: m.channelIdentifier.channelId,
    senderId: m.senderUserId,
    sentTime: m.sentTime || Date.now(),
    kind: 'unknown',
    rawType: m.messageType,
    direction: out ? 'out' : 'in',
    status: m.sentStatus === 20 ? 'failed' : m.sentStatus === 10 ? 'sending' : 'sent',
    needReceipt: !!m.needReceipt,
    receiptSent: !!m.sentReceipt,
    ...extra,
  };
  switch (m.messageType) {
    case BUILTIN_MESSAGE_TYPES.text: {
      const t = parseTextContent(m.content);
      return t ? { ...base, kind: 'text', text: t.text, mentionedUserIds: t.mentionedUserIds, mentionAll: t.mentionAll } : base;
    }
    case BUILTIN_MESSAGE_TYPES.image: {
      const img = parseImageContent(m.content);
      return img ? { ...base, kind: 'image', image: img } : base;
    }
    case BUILTIN_MESSAGE_TYPES.hdVoice: {
      const v = parseVoiceContent(m.content);
      return v ? { ...base, kind: 'voice', voice: v } : base;
    }
    case MESSAGE_TYPES.notice: {
      const n = NoticeMessage.safeParse(asObject(m.content));
      return n.success ? { ...base, kind: 'notice', notice: { kind: n.data.kind, text: n.data.text } } : base;
    }
    case BUILTIN_MESSAGE_TYPES.stream: {
      const st = parseStreamContent(m.content);
      return st ? { ...base, kind: 'stream', text: st.text, streamComplete: st.complete } : base;
    }
    default:
      if (isCardType(m.messageType)) return { ...base, kind: 'card', card: decodeCard(m.messageType, m.content), meta: metaRecord(m.metadata) };
      return base;
  }
}

/** One-line preview for the crew list. */
export function previewText(m: ChatMessage | null): string {
  if (!m) return '';
  switch (m.kind) {
    case 'text':
      return m.text ?? '';
    case 'image':
      return '📷 Photo';
    case 'voice':
      return `🎙️ Voice note${m.voice?.durationS ? ` (${formatDuration(m.voice.durationS)})` : ''}`;
    case 'notice':
      return m.notice?.text ?? '';
    case 'card':
      return m.card ? cardPreview(m.card) : '🃏 Card';
    case 'stream':
      return (m.text ?? '').replace(/[*_`#]/g, '').slice(0, 120);
    default:
      return 'New message';
  }
}

export function formatDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

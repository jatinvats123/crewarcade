// Pure chat reducer: ordering, dedupe and optimistic sends. Unit-tested (test/chat-reducer.test.ts).
// Rules:
//  - Messages are kept sorted by sentTime (ties: messageId/key), so history pages, live messages and
//    offline sync can arrive in any order.
//  - A messageId appears once. A live echo of our own send (multi-device sync) merges into the
//    optimistic copy instead of duplicating it.
//  - Optimistic sends are keyed by localId until the server assigns a messageId.
import type { AgentStateMessage } from '@crewarcade/shared';
import { emptyChannel, type ChannelState, type ChatMessage, type ChatState } from './types';

/** A busy state with no heartbeat for this long is dropped (the server beats every 5 s). */
export const AGENT_STATE_TTL_MS = 15_000;
/** Waiting/blocked states are not beaten; they stay this long. */
export const AGENT_IDLE_STATE_TTL_MS = 30 * 60_000;
const BUSY = new Set(['thinking', 'designing', 'building', 'checking', 'testing', 'fixing']);

export type ChatAction =
  | { type: 'history/loaded'; channelId: string; messages: ChatMessage[]; hasMore: boolean }
  | { type: 'message/received'; message: ChatMessage; active: boolean }
  | { type: 'message/optimistic'; message: ChatMessage }
  | { type: 'message/progress'; channelId: string; localId: string; progress: number }
  | { type: 'message/sent'; channelId: string; localId: string; message: ChatMessage }
  | { type: 'message/failed'; channelId: string; localId: string; errorCode?: number }
  | { type: 'message/retry'; channelId: string; localId: string }
  | { type: 'message/blocked'; channelId: string; messageId: string; reason: string }
  | { type: 'message/deleted'; channelId: string; messageIds: string[] }
  | { type: 'receipts/updated'; channelId: string; receipts: Array<{ messageId: string; readCount: number; totalCount: number }> }
  | { type: 'receipts/sent'; channelId: string; messageIds: string[] }
  | { type: 'typing/started'; channelId: string; userId: string; until: number }
  | { type: 'typing/expire'; now: number }
  | { type: 'unread/set'; channelId: string; count: number }
  | { type: 'preview/set'; channelId: string; message: ChatMessage | null; unread: number }
  | { type: 'agent/state'; channelId: string; state: AgentStateMessage; receivedAt: number }
  | { type: 'agent/expire'; now: number }
  | { type: 'message/metadata'; channelId: string; messageId: string; metadata: Record<string, string>; replace?: boolean }
  | { type: 'stream/delta'; messageId: string; text: string; channelId?: string }
  | { type: 'stream/complete'; messageId: string };

const compare = (a: ChatMessage, b: ChatMessage) => a.sentTime - b.sentTime || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** Inserts or replaces messages, keeping order and one entry per messageId / localId. */
export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return existing;
  const out = [...existing];
  for (const m of incoming) {
    const i = out.findIndex(x => (m.messageId && x.messageId === m.messageId) || (m.localId && x.localId === m.localId));
    if (i === -1) out.push(m);
    else {
      const prev = out[i]!;
      const readCount = prev.readCount === undefined && m.readCount === undefined ? undefined : Math.max(prev.readCount ?? 0, m.readCount ?? 0);
      // Keep local-only knowledge (React key, localId, receipts already sent, block reasons) when the server copy arrives.
      out[i] = {
        ...prev,
        ...m,
        key: prev.key,
        localId: prev.localId ?? m.localId,
        receiptSent: prev.receiptSent || m.receiptSent,
        ...(prev.blockedReason && { blockedReason: prev.blockedReason }),
        ...(readCount !== undefined && { readCount }),
        totalCount: m.totalCount ?? prev.totalCount,
        ...((prev.meta || m.meta) && { meta: { ...prev.meta, ...m.meta } }),
        // A stream that already grew live keeps its longer text until the server copy catches up.
        ...(prev.kind === 'stream' && m.kind === 'stream' && (prev.text?.length ?? 0) > (m.text?.length ?? 0) && !m.streamComplete && { text: prev.text }),
        ...(prev.streamComplete && { streamComplete: true }),
      };
    }
  }
  return out.sort(compare);
}

function update(state: ChatState, channelId: string, fn: (c: ChannelState) => ChannelState): ChatState {
  const prev = state.channels[channelId] ?? emptyChannel();
  const next = fn(prev);
  return next === prev ? state : { ...state, channels: { ...state.channels, [channelId]: next } };
}

function patchByLocalId(c: ChannelState, localId: string, patch: Partial<ChatMessage>): ChannelState {
  const i = c.messages.findIndex(m => m.localId === localId);
  if (i === -1) return c;
  const messages = [...c.messages];
  messages[i] = { ...messages[i]!, ...patch };
  return { ...c, messages };
}

/** Counted kinds raise the unread badge (notices and signals do not). */
const counts = (m: ChatMessage) => m.kind !== 'notice' && m.direction === 'in';

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'history/loaded':
      return update(state, action.channelId, c => ({ ...c, messages: mergeMessages(c.messages, action.messages), hasMore: action.hasMore, loaded: true }));

    case 'message/received':
      return update(state, action.message.channelId, c => {
        const known = c.messages.some(m => m.messageId && m.messageId === action.message.messageId);
        const typing = { ...c.typing };
        delete typing[action.message.senderId];
        return {
          ...c,
          messages: mergeMessages(c.messages, [action.message]),
          preview: !c.preview || c.preview.sentTime <= action.message.sentTime ? action.message : c.preview,
          unread: !known && !action.active && counts(action.message) ? c.unread + 1 : c.unread,
          typing,
        };
      });

    case 'message/optimistic':
      return update(state, action.message.channelId, c => ({ ...c, messages: mergeMessages(c.messages, [action.message]), preview: action.message }));

    case 'message/progress':
      return update(state, action.channelId, c => patchByLocalId(c, action.localId, { progress: action.progress }));

    case 'message/sent':
      return update(state, action.channelId, c => {
        const echoed = action.message.messageId ? c.messages.find(m => m.messageId === action.message.messageId && m.localId !== action.localId) : undefined;
        // The echo (another device / sync) got here first: drop it and keep our optimistic entry's key.
        const base = echoed ? c.messages.filter(m => m !== echoed) : c.messages;
        const i = base.findIndex(m => m.localId === action.localId);
        if (i === -1) return { ...c, messages: mergeMessages(base, [{ ...action.message, localId: action.localId }]) };
        const prev = base[i]!;
        const sent: ChatMessage = {
          ...prev,
          ...action.message,
          key: prev.key,
          localId: action.localId,
          status: 'sent',
          progress: undefined,
          errorCode: undefined,
        };
        const messages = [...base];
        messages[i] = sent;
        return { ...c, messages: messages.sort(compare), preview: c.preview?.localId === action.localId ? sent : c.preview };
      });

    case 'message/failed':
      return update(state, action.channelId, c => patchByLocalId(c, action.localId, { status: 'failed', progress: undefined, errorCode: action.errorCode }));

    case 'message/retry':
      return update(state, action.channelId, c => patchByLocalId(c, action.localId, { status: 'sending', errorCode: undefined }));

    case 'message/blocked':
      return update(state, action.channelId, c => {
        const i = c.messages.findIndex(m => m.messageId === action.messageId);
        if (i === -1) return c;
        const messages = [...c.messages];
        messages[i] = { ...messages[i]!, blockedReason: action.reason };
        return { ...c, messages };
      });

    case 'message/deleted':
      return update(state, action.channelId, c => ({ ...c, messages: c.messages.filter(m => !m.messageId || !action.messageIds.includes(m.messageId)) }));

    case 'receipts/updated':
      return update(state, action.channelId, c => {
        const byId = new Map(action.receipts.map(r => [r.messageId, r]));
        let changed = false;
        const messages = c.messages.map(m => {
          const r = m.messageId ? byId.get(m.messageId) : undefined;
          if (!r || (m.readCount === r.readCount && m.totalCount === r.totalCount)) return m;
          changed = true;
          // Read counts only go up (late, out-of-order responses must not undo a "seen").
          return { ...m, readCount: Math.max(m.readCount ?? 0, r.readCount), totalCount: r.totalCount };
        });
        return changed ? { ...c, messages } : c;
      });

    case 'receipts/sent':
      return update(state, action.channelId, c => ({
        ...c,
        messages: c.messages.map(m => (m.messageId && action.messageIds.includes(m.messageId) ? { ...m, receiptSent: true } : m)),
      }));

    case 'typing/started':
      return update(state, action.channelId, c => ({ ...c, typing: { ...c.typing, [action.userId]: action.until } }));

    case 'typing/expire': {
      let changed = false;
      const channels: ChatState['channels'] = {};
      for (const [id, c] of Object.entries(state.channels)) {
        const live = Object.entries(c.typing).filter(([, until]) => until > action.now);
        if (live.length !== Object.keys(c.typing).length) {
          changed = true;
          channels[id] = { ...c, typing: Object.fromEntries(live) };
        } else channels[id] = c;
      }
      return changed ? { ...state, channels } : state;
    }

    case 'unread/set':
      return update(state, action.channelId, c => (c.unread === action.count ? c : { ...c, unread: action.count }));

    case 'preview/set':
      return update(state, action.channelId, c => ({ ...c, preview: action.message ?? c.preview, unread: action.unread }));

    case 'agent/state':
      return update(state, action.channelId, c => {
        const agentStates = { ...c.agentStates };
        if (action.state.state === 'idle') delete agentStates[action.state.agentId];
        else agentStates[action.state.agentId] = { ...action.state, receivedAt: action.receivedAt };
        return { ...c, agentStates };
      });

    case 'agent/expire': {
      let changed = false;
      const channels: ChatState['channels'] = {};
      for (const [id, c] of Object.entries(state.channels)) {
        const live = Object.entries(c.agentStates).filter(
          ([, s]) => action.now - s.receivedAt < (BUSY.has(s.state) ? AGENT_STATE_TTL_MS : AGENT_IDLE_STATE_TTL_MS),
        );
        if (live.length !== Object.keys(c.agentStates).length) {
          changed = true;
          channels[id] = { ...c, agentStates: Object.fromEntries(live) };
        } else channels[id] = c;
      }
      return changed ? { ...state, channels } : state;
    }

    case 'message/metadata':
      return update(state, action.channelId, c => {
        const i = c.messages.findIndex(m => m.messageId === action.messageId);
        if (i === -1) return c;
        const messages = [...c.messages];
        const prev = messages[i]!;
        messages[i] = { ...prev, meta: action.replace ? { ...action.metadata } : { ...prev.meta, ...action.metadata } };
        return { ...c, messages };
      });

    case 'stream/delta':
    case 'stream/complete': {
      // Stream events carry only the messageId: find the channel that holds it.
      const channelId =
        (action.type === 'stream/delta' && action.channelId) ||
        Object.keys(state.channels).find(id => state.channels[id]!.messages.some(m => m.messageId === action.messageId));
      if (!channelId) return state;
      return update(state, channelId, c => {
        const i = c.messages.findIndex(m => m.messageId === action.messageId);
        if (i === -1) return c;
        const messages = [...c.messages];
        const prev = messages[i]!;
        messages[i] =
          action.type === 'stream/delta'
            ? { ...prev, kind: 'stream', text: action.text.length >= (prev.text?.length ?? 0) ? action.text : prev.text, streamComplete: false }
            : { ...prev, streamComplete: true };
        return { ...c, messages, preview: c.preview?.messageId === action.messageId ? messages[i]! : c.preview };
      });
    }
  }
}

/** Busy and waiting agents of a channel, Pixel, Forge, Glitch order. */
export function roomAgentStates(c: ChannelState | undefined): Array<AgentStateMessage & { receivedAt: number }> {
  if (!c) return [];
  return (['pixel', 'forge', 'glitch'] as const).map(k => c.agentStates[k]).filter((s): s is AgentStateMessage & { receivedAt: number } => !!s);
}

/** Names of people typing in a channel (excluding me), in a stable order. */
export function typingUserIds(c: ChannelState | undefined, me: string, now: number): string[] {
  if (!c) return [];
  return Object.entries(c.typing)
    .filter(([id, until]) => id !== me && until > now)
    .map(([id]) => id)
    .sort();
}

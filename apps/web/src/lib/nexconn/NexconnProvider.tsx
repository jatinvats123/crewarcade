'use client';

// The one Nexconn client of the app (docs: /chatsdk-web/init.md, listener.md, connection/*.md).
// Order, as the docs require: initialize once -> registerCustomMessages -> add handlers -> connect.
//  - The SDK is loaded with a dynamic import, so it never runs during SSR and stays out of the
//    landing page bundle.
//  - The token comes from POST /api/nexconn/token (our server issues it; the App Secret never
//    reaches the browser). On "token incorrect or expired" (31004) we fetch a fresh one and
//    connect again; the SDK handles ordinary reconnects itself (every 5 s).
//  - All SDK names below were checked in node_modules/@nexconn/chat/index.d.ts (v26.2.1).
import {
  AgentStateMessage,
  asObject,
  BUILTIN_MESSAGE_TYPES,
  MESSAGE_TYPE_REGISTRY,
  MESSAGE_TYPES,
  TYPING_TTL_MS,
  type NexconnTokenResponse,
} from '@crewarcade/shared';
import type * as NexconnSdk from '@nexconn/chat';
import type { BaseChannel, Message } from '@nexconn/chat';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiRequestError } from '../api';
import { normalizeMessage, parseStreamContent, streamSummary, type SdkMessageLike } from '../chat/normalize';
import { createChatStore, createPresenceStore, type ChatStore, type PresenceStore } from '../chat/store';
import type { ChatMessage } from '../chat/types';
import { createTranslationStore, TranslationContext, type TranslateOutcome, type TranslationApi } from '../chat/translations';
import { afterTokenRejected } from './retry';
import { useSession } from '../session';

type Sdk = typeof NexconnSdk;

export type ConnectionState = 'idle' | 'unconfigured' | 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'kicked' | 'error';

/** SDK status codes we act on (/chatsdk-web/code.md). */
const CODE = { tokenInvalid: 31004, kicked: 31010, reconnectExhausted: 33007, rateLimited: 30004, rejected: 30007 } as const;

export interface SeenByUser {
  userId: string;
  timestamp: number;
}

interface NexconnValue {
  state: ConnectionState;
  /** Time of the last successful reconnect (for the "Back online" banner). */
  reconnectedAt: number | null;
  /** Nexconn user id of the signed-in user. */
  myId: string | null;
  store: ChatStore;
  presence: PresenceStore;
  retryConnect: () => void;
  setActiveChannel: (channelId: string | null) => void;
  loadHistory: (channelId: string) => Promise<void>;
  markRead: (channelId: string) => void;
  sendText: (channelId: string, text: string, mentionUserIds: string[]) => void;
  sendImage: (channelId: string, file: File) => void;
  /** A voice note; with mentions (e.g. @pixel) the server transcribes it and routes it like text. */
  sendVoice: (channelId: string, file: File, durationS: number, mentionUserIds?: string[]) => void;
  retry: (channelId: string, localId: string) => void;
  sendTyping: (channelId: string) => void;
  watchPresence: (userIds: string[]) => void;
  seenBy: (channelId: string, messageId: string) => Promise<SeenByUser[]>;
  onUnknownChannel: (fn: (channelId: string) => void) => () => void;
}

const NexconnContext = createContext<NexconnValue | null>(null);

/** Direct channels are keyed by the other user's id; ours are only DMs from agents (Glitch's challenges). */
export const isDirectWithAgent = (channelId: string): boolean => /^agent(pixel|forge|glitch)$/.test(channelId);

// Module-level: NCEngine.initialize must run exactly once per page lifetime (also under React
// Strict Mode, which mounts effects twice in development).
let sdkPromise: Promise<Sdk> | null = null;
let initializedKey: string | null = null;
const loadSdk = () => (sdkPromise ??= import('@nexconn/chat'));

const newLocalId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function NexconnProvider({ children }: { children: ReactNode }) {
  const { status: session, user } = useSession();
  const store = useMemo(createChatStore, []);
  const presence = useMemo(createPresenceStore, []);
  const [state, setState] = useState<ConnectionState>('idle');
  const [reconnectedAt, setReconnectedAt] = useState<number | null>(null);
  const [myId, setMyId] = useState<string | null>(null);

  const sdkRef = useRef<Sdk | null>(null);
  const tokenRef = useRef<NexconnTokenResponse | null>(null);
  const myIdRef = useRef<string | null>(null);
  const activeRef = useRef<string | null>(null);
  const everConnected = useRef(false);
  const queries = useRef(new Map<string, ReturnType<Sdk['BaseChannel']['createMessagesQuery']>>());
  const resend = useRef(new Map<string, () => Promise<void>>());
  const subscribed = useRef(new Set<string>());
  const unknownListeners = useRef(new Set<(channelId: string) => void>());
  const receiptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set when Nexconn says the token is invalid or expired: the next attempt asks for a new one. */
  const needFreshToken = useRef(false);
  /** Token rejections / exhausted reconnects in a row (see retry.ts); reset on connect and Try again. */
  const rejects = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const userId = user?.id ?? null;
  const translations = useMemo(createTranslationStore, []);
  const translateWaiters = useRef(new Map<string, (ok: boolean) => void>());

  const isActive = (channelId: string) => activeRef.current === channelId && typeof document !== 'undefined' && document.visibilityState === 'visible';
  const normalize = useCallback(
    (m: Message, extra?: Partial<ChatMessage>) => normalizeMessage(m as unknown as SdkMessageLike, myIdRef.current ?? '', extra),
    [],
  );

  /** The channel already holding this message, if any. */
  const channelOfMessage = useCallback(
    (messageId: string): string | undefined => {
      const channels = store.getState().channels;
      return Object.keys(channels).find(id => channels[id]!.messages.some(m => m.messageId === messageId));
    },
    [store],
  );

  /** Stream events for messages we don't have yet: latest text + whether it finished. */
  const orphanStreams = useRef(new Map<string, { text: string; complete: boolean; looking: boolean; tries: number }>());
  const adoptStream = useCallback(
    async (messageId: string) => {
      const o = orphanStreams.current.get(messageId);
      const sdk = sdkRef.current;
      if (!o || o.looking || !sdk) return;
      o.looking = true;
      const candidates = [...new Set([activeRef.current, ...Object.keys(store.getState().channels)].filter((c): c is string => !!c))];
      for (const channelId of candidates) {
        const r = await sdk.BaseChannel.getMessagesByIds({ channelIdentifier: new sdk.GroupChannel(channelId).identifier, messageIds: [messageId] });
        const found = r.isOk ? r.data?.[messageId] : undefined;
        if (!found) continue;
        const latest = orphanStreams.current.get(messageId) ?? o;
        orphanStreams.current.delete(messageId);
        const n = normalize(found);
        const text = (n.text ?? '').length >= latest.text.length ? (n.text ?? '') : latest.text;
        store.dispatch({
          type: 'message/received',
          message: { ...n, kind: 'stream', text, streamComplete: latest.complete || !!n.streamComplete },
          active: isActive(channelId),
        });
        return;
      }
      // Not stored yet (still streaming): try again shortly, a few times.
      o.looking = false;
      if (++o.tries < 10) setTimeout(() => void adoptStream(messageId), 800);
      else orphanStreams.current.delete(messageId);
    },
    [store, normalize],
  );
  const noteOrphanStream = useCallback(
    (messageId: string, patch: { text?: string; complete?: boolean }) => {
      const o = orphanStreams.current.get(messageId) ?? { text: '', complete: false, looking: false, tries: 0 };
      if (patch.text !== undefined && patch.text.length >= o.text.length) o.text = patch.text;
      if (patch.complete) o.complete = true;
      orphanStreams.current.set(messageId, o);
      // Once adopted, deltas go straight to the reducer.
      const channelId = channelOfMessage(messageId);
      if (channelId) {
        orphanStreams.current.delete(messageId);
        if (o.text) store.dispatch({ type: 'stream/delta', messageId, text: o.text });
        if (o.complete) store.dispatch({ type: 'stream/complete', messageId });
        return;
      }
      void adoptStream(messageId);
    },
    [store, channelOfMessage, adoptStream],
  );

  /** Streams we already followed, by messageId. */
  const streamsRequested = useRef(new Set<string>());
  /**
   * An agent's streamed reply. Live (2026-11-14, scripts/stream-repro.ts): Nexconn stores only the
   * FIRST chunk in history (isCompleted stays false) and never pushes server-sent streams through
   * onMessageReceived, so for every stream we don't fully have we call requestStreamMessage(); the
   * text then arrives on onStreamMessageRequestDelta (also for streams that already finished).
   */
  const followStream = useCallback(
    (m: Message) => {
      if (m.messageType !== BUILTIN_MESSAGE_TYPES.stream || !m.messageId || streamsRequested.current.has(m.messageId)) return;
      if (!parseStreamContent(m.content)) return;
      const have = store.getState().channels[m.channelIdentifier.channelId]?.messages.find(x => x.messageId === m.messageId);
      if (have?.streamComplete) return;
      streamsRequested.current.add(m.messageId);
      void m.requestStreamMessage().then(r => {
        if (!r.isOk) {
          console.warn('[nexconn] requestStreamMessage failed', r.code);
          streamsRequested.current.delete(m.messageId);
        }
      });
    },
    [store],
  );
  /** CA:AgentState named a stream being written: fetch it by id and pull its chunks. */
  const pullStream = useCallback(
    async (channelId: string, messageId: string, attempt = 1) => {
      const sdk = sdkRef.current;
      if (!sdk || streamsRequested.current.has(messageId) || channelOfMessage(messageId)) return;
      const r = await sdk.BaseChannel.getMessagesByIds({ channelIdentifier: new sdk.GroupChannel(channelId).identifier, messageIds: [messageId] });
      const found = r.isOk ? r.data?.[messageId] : undefined;
      if (!found) {
        if (attempt < 5) setTimeout(() => void pullStream(channelId, messageId, attempt + 1), 600 * attempt);
        return;
      }
      if (!channelOfMessage(messageId)) store.dispatch({ type: 'message/received', message: normalize(found), active: isActive(channelId) });
      followStream(found);
    },
    [store, normalize, channelOfMessage, followStream],
  );

  // ---- read receipts: debounced, for messages of the active channel that asked for one
  const flushReceipts = useCallback(
    (channelId: string) => {
      const sdk = sdkRef.current;
      if (!sdk || !isActive(channelId)) return;
      const c = store.getState().channels[channelId];
      const ids = (c?.messages ?? []).filter(m => m.direction === 'in' && m.needReceipt && !m.receiptSent && m.messageId).map(m => m.messageId!);
      if (isDirectWithAgent(channelId)) {
        // Agent DMs (Glitch's challenges): clear the badge; no read receipts.
        void new sdk.DirectChannel(channelId).clearUnreadCount().catch(() => {});
        store.dispatch({ type: 'unread/set', channelId, count: 0 });
        return;
      }
      const channel = new sdk.GroupChannel(channelId);
      void channel.clearUnreadCount().catch(() => {});
      store.dispatch({ type: 'unread/set', channelId, count: 0 });
      if (ids.length === 0) return;
      store.dispatch({ type: 'receipts/sent', channelId, messageIds: ids });
      void channel.sendReadReceiptResponse(ids.slice(-100)).then(r => {
        if (!r.isOk) console.warn('[nexconn] read receipt failed', r.code);
      });
    },
    [store],
  );
  const markRead = useCallback(
    (channelId: string) => {
      if (receiptTimer.current) clearTimeout(receiptTimer.current);
      receiptTimer.current = setTimeout(() => flushReceipts(channelId), 400);
    },
    [flushReceipts],
  );

  // ---- catch-up for agent replies streamed while we were watching
  // Live check (2026-11-14, Web SDK 26.2.1): server-sent RC:StreamMsg replies reached this client
  // neither through onMessageReceived nor the stream events, but they are in history. So whenever an
  // agent message arrives live (e.g. the plan card right after the intro), the newest messages of
  // that room are fetched and merged; the reply then appears just above the card.
  const catchUpTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const catchUp = useCallback(
    (channelId: string) => {
      const pending = catchUpTimers.current.get(channelId);
      if (pending) clearTimeout(pending);
      catchUpTimers.current.set(
        channelId,
        setTimeout(() => {
          catchUpTimers.current.delete(channelId);
          const sdk = sdkRef.current;
          if (!sdk) return;
          const q = sdk.BaseChannel.createMessagesQuery({
            channelIdentifier: new sdk.GroupChannel(channelId).identifier,
            startTime: Date.now() + 10_000,
            pageSize: 10,
            isAscending: false,
          });
          void q.loadNextPage().then(res => {
            if (!res.isOk || !res.data) return;
            const fresh = (res.data.data as Message[]).filter(x => x.messageType === BUILTIN_MESSAGE_TYPES.stream && !channelOfMessage(x.messageId));
            for (const x of fresh) store.dispatch({ type: 'message/received', message: normalize(x), active: isActive(channelId) });
          });
        }, 400),
      );
    },
    [store, normalize, channelOfMessage],
  );

  // ---- incoming
  const handleIncoming = useCallback(
    (m: Message) => {
      const channelId = m.channelIdentifier.channelId;
      if (m.messageType === MESSAGE_TYPES.typing) {
        if (m.senderUserId !== myIdRef.current)
          store.dispatch({ type: 'typing/started', channelId, userId: m.senderUserId, until: Date.now() + TYPING_TTL_MS });
        return;
      }
      if (m.messageType === MESSAGE_TYPES.agentState) {
        const s = AgentStateMessage.safeParse(asObject(m.content));
        if (s.success) {
          store.dispatch({ type: 'agent/state', channelId, state: s.data, receivedAt: Date.now() });
          if (s.data.streamId) void pullStream(channelId, s.data.streamId);
        }
        return;
      }
      if (m.messageType === MESSAGE_TYPES.reaction) return; // Live Theater (Phase 3)
      const active = isActive(channelId);
      store.dispatch({ type: 'message/received', message: normalize(m), active });
      followStream(m);
      // Agent ids are "agentpixel", "agentforge", "agentglitch" on Nexconn.
      if (m.senderUserId.startsWith('agent') && m.messageType !== BUILTIN_MESSAGE_TYPES.stream) catchUp(channelId);
      if (!store.getState().channels[channelId]?.loaded) for (const l of unknownListeners.current) l(channelId);
      if (active) markRead(channelId);
    },
    [store, normalize, markRead, followStream, catchUp, pullStream],
  );

  const refreshChannelList = useCallback(async () => {
    const sdk = sdkRef.current;
    if (!sdk) return;
    const q = sdk.BaseChannel.createChannelsQuery({ pageSize: 50 });
    const res = await q.loadNextPage();
    if (!res.isOk || !res.data) return;
    for (const ch of res.data.data as BaseChannel[]) {
      const latest = ch.latestMessage;
      store.dispatch({
        type: 'preview/set',
        channelId: ch.channelId,
        message: latest ? normalize(latest) : null,
        unread: isActive(ch.channelId) ? 0 : ch.unreadCount,
      });
    }
  }, [store, normalize]);

  const refreshPresence = useCallback(
    async (ids: string[]) => {
      const sdk = sdkRef.current;
      if (!sdk || ids.length === 0) return;
      for (let i = 0; i < ids.length; i += 100) {
        const r = await sdk.NCEngine.userModule.getSubscribeUsersOnlineStatus(ids.slice(i, i + 100));
        if (r.isOk && r.data) presence.dispatch({ type: 'set', entries: r.data.map(s => [s.userId, s.isOnline] as [string, boolean]) });
      }
    },
    [presence],
  );

  // ---- connect lifecycle
  useEffect(() => {
    if (session !== 'ready' || !userId) {
      setState('idle');
      return;
    }
    let cancelled = false;
    // Rejected token or reconnects exhausted: a fresh token and another go, a limited number of times.
    const onRejected = (tokenInvalid: boolean) => {
      rejects.current += 1;
      const plan = afterTokenRejected(rejects.current);
      if (!plan.retry) {
        console.warn('[nexconn] giving up after repeated token rejections');
        setState('error');
        return;
      }
      needFreshToken.current = tokenInvalid;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => setAttempt(a => a + 1), plan.delayMs);
    };
    const run = async () => {
      setState(everConnected.current ? 'reconnecting' : 'connecting');
      let token: NexconnTokenResponse;
      try {
        token = await api.nexconnToken(needFreshToken.current);
        needFreshToken.current = false;
      } catch (e) {
        if (!cancelled) setState(e instanceof ApiRequestError && e.status === 503 ? 'unconfigured' : 'error');
        return;
      }
      tokenRef.current = token;
      const sdk = await loadSdk();
      if (cancelled) return;
      sdkRef.current = sdk;
      const { NCEngine, LogLevel, AreaCode, ConnectionStatus, ConnectionStatusHandler, MessageHandler, ChannelHandler, UserHandler, TranslateHandler } = sdk;
      if (initializedKey === null) {
        NCEngine.initialize({ appKey: token.appKey, areaCode: AreaCode.SG, logLevel: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.WARN });
        NCEngine.registerCustomMessages(MESSAGE_TYPE_REGISTRY.map(r => ({ ...r })));
        initializedKey = token.appKey;
      }
      NCEngine.addConnectionStatusHandler(
        'crewarcade',
        new ConnectionStatusHandler({
          onConnectionStatusChanged({ status, code }) {
            if (status === ConnectionStatus.CONNECTED) {
              rejects.current = 0;
              if (everConnected.current) setReconnectedAt(Date.now());
              everConnected.current = true;
              setState('connected');
              void refreshChannelList();
              void refreshPresence([...subscribed.current]);
            } else if (status === ConnectionStatus.CONNECTING) setState(everConnected.current ? 'reconnecting' : 'connecting');
            else if (code === CODE.kicked) setState('kicked');
            else if (code === CODE.tokenInvalid || code === CODE.reconnectExhausted) onRejected(code === CODE.tokenInvalid);
            else setState('offline');
          },
        }),
      );
      NCEngine.addMessageHandler(
        'crewarcade',
        new MessageHandler({
          onMessageReceived: ({ messages }) => messages.forEach(handleIncoming),
          onOfflineMessageSyncCompleted: () => void refreshChannelList(),
          onMessageDeleted: ({ messages }) => {
            for (const d of messages) store.dispatch({ type: 'message/deleted', channelId: d.channelIdentifier.channelId, messageIds: [d.messageId] });
          },
          onMessageBlocked: ({ info }) =>
            store.dispatch({
              type: 'message/blocked',
              channelId: info.channelIdentifier.channelId,
              messageId: info.messageId,
              reason: info.extra?.trim() || 'This message was not delivered.',
            }),
          // Card votes/approvals (metadata/set on the server) update the card in place.
          // A finished stream's full text arrives as RC_Ext_StreamMsgSummary metadata.
          onMessageMetadataUpdated: ({ messageId, channelIdentifier, metadata }) => {
            const sum = streamSummary(metadata as Record<string, unknown> | Map<string, unknown>);
            if (sum) {
              if (channelOfMessage(messageId)) {
                store.dispatch({ type: 'stream/delta', messageId, text: sum.text });
                if (sum.complete) store.dispatch({ type: 'stream/complete', messageId });
              } else noteOrphanStream(messageId, { text: sum.text, complete: sum.complete });
              return;
            }
            store.dispatch({ type: 'message/metadata', channelId: channelIdentifier.channelId, messageId, metadata });
          },
          // Live (2026-11-14): agent streams reach group members only through these events, keyed by
          // messageId with no channel. Unknown ids are adopted: the text is kept and the message is
          // looked up in the open room (then the other loaded rooms) so it appears and keeps growing.
          onStreamMessageRequestInit: ({ messageId }) => {
            if (!channelOfMessage(messageId)) noteOrphanStream(messageId, {});
          },
          onStreamMessageRequestDelta: ({ messageId, chunkInfo }) => {
            if (channelOfMessage(messageId)) store.dispatch({ type: 'stream/delta', messageId, text: chunkInfo.messageContent });
            else noteOrphanStream(messageId, { text: chunkInfo.messageContent });
          },
          onStreamMessageRequestComplete: ({ messageId }) => {
            if (channelOfMessage(messageId)) store.dispatch({ type: 'stream/complete', messageId });
            else noteOrphanStream(messageId, { complete: true });
          },
          onMessageReceiptResponse: ({ responses }) => {
            for (const r of responses)
              store.dispatch({
                type: 'receipts/updated',
                channelId: r.channelIdentifier.channelId,
                receipts: [{ messageId: r.messageId, readCount: r.readCount, totalCount: r.totalCount }],
              });
          },
        }),
      );
      // Direct-channel typing (CA:Typing covers groups; see MESSAGE_TYPES.typing).
      NCEngine.addChannelHandler(
        'crewarcade',
        new ChannelHandler({
          onTypingStatusChanged: ({ channelIdentifier, userTypingStatus }) => {
            for (const t of userTypingStatus)
              store.dispatch({ type: 'typing/started', channelId: channelIdentifier.channelId, userId: t.userId, until: Date.now() + TYPING_TTL_MS });
          },
        }),
      );
      // Tap-to-translate results (translateMessages only means "accepted").
      NCEngine.addTranslateHandler(
        'crewarcade',
        new TranslateHandler({
          onTranslationCompleted: ({ results }) => {
            for (const r of results) {
              const text = r.translateInfo?.translatedText?.trim();
              const ok = r.code === 0 && !!text;
              if (ok) translations.set(r.identifier, { state: 'done', text: text!, from: null });
              translateWaiters.current.get(r.identifier)?.(ok);
              translateWaiters.current.delete(r.identifier);
            }
          },
        }),
      );
      NCEngine.addUserHandler(
        'crewarcade',
        new UserHandler({
          onSubscriptionChanged: ({ events }) => void refreshPresence(events.map(e => e.userId)),
        }),
      );

      const res = await NCEngine.connect({ token: token.token });
      if (cancelled) return;
      if (res.isOk && res.data) {
        rejects.current = 0;
        myIdRef.current = res.data.userId;
        setMyId(res.data.userId);
        everConnected.current = true;
        setState('connected');
        void refreshChannelList();
      } else if (res.code === CODE.tokenInvalid) {
        onRejected(true);
      } else {
        console.warn('[nexconn] connect failed', res.code);
        setState(res.code === CODE.kicked ? 'kicked' : 'error');
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [session, userId, attempt, handleIncoming, refreshChannelList, refreshPresence, store, channelOfMessage, noteOrphanStream, translations]);

  // Sign-out / unmount: drop the connection.
  useEffect(() => {
    if (session === 'anonymous' && sdkRef.current) void sdkRef.current.NCEngine.disconnect();
  }, [session]);

  // Typing indicators and agent states without a heartbeat expire on their own.
  useEffect(() => {
    const t = setInterval(() => {
      store.dispatch({ type: 'typing/expire', now: Date.now() });
      store.dispatch({ type: 'agent/expire', now: Date.now() });
    }, 1000);
    return () => clearInterval(t);
  }, [store]);

  // Coming back to the tab or the network: catch up.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && activeRef.current) markRead(activeRef.current);
    };
    const onOnline = () => {
      // Only when the SDK gave up; while it is CONNECTING its own 5 s retry loop is running.
      if (sdkRef.current && sdkRef.current.NCEngine.getConnectionStatus() === sdkRef.current.ConnectionStatus.DISCONNECTED) setAttempt(a => a + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [markRead]);

  // ---- actions
  const historyInflight = useRef(new Map<string, Promise<void>>());
  const loadHistoryPage = useCallback(
    async (channelId: string) => {
      const sdk = sdkRef.current;
      if (!sdk) return;
      let q = queries.current.get(channelId);
      if (!q) {
        q = sdk.BaseChannel.createMessagesQuery({
          channelIdentifier: (isDirectWithAgent(channelId) ? new sdk.DirectChannel(channelId) : new sdk.GroupChannel(channelId)).identifier,
          startTime: Date.now() + 10_000,
          pageSize: 30,
          isAscending: false,
        });
        queries.current.set(channelId, q);
      }
      const res = await q.loadNextPage();
      if (!res.isOk || !res.data) {
        console.warn('[nexconn] history failed', res.code);
        store.dispatch({ type: 'history/loaded', channelId, messages: [], hasMore: true });
        return;
      }
      const page = (res.data.data as Message[]).filter(m => !MESSAGE_TYPE_REGISTRY.some(r => r.isStatusMessage && r.messageType === m.messageType));
      store.dispatch({ type: 'history/loaded', channelId, messages: page.map(m => normalize(m)), hasMore: q.hasNext });
      for (const m of page) followStream(m);
      // Read counts for my own messages on this page.
      const mine = page.filter(m => m.senderUserId === myIdRef.current && m.needReceipt).map(m => m.messageId);
      if (mine.length && !isDirectWithAgent(channelId)) {
        const info = await new sdk.GroupChannel(channelId).getMessageReadReceiptInfo(mine);
        if (info.isOk && info.data)
          store.dispatch({
            type: 'receipts/updated',
            channelId,
            receipts: info.data.map(i => ({ messageId: i.messageId, readCount: i.readCount, totalCount: i.totalCount })),
          });
      }
      if (isActive(channelId)) markRead(channelId);
    },
    [store, normalize, markRead, followStream],
  );
  /** One page at a time per channel, however many callers ask. */
  const loadHistory = useCallback(
    (channelId: string) => {
      const pending = historyInflight.current.get(channelId);
      if (pending) return pending;
      const p = loadHistoryPage(channelId).finally(() => historyInflight.current.delete(channelId));
      historyInflight.current.set(channelId, p);
      return p;
    },
    [loadHistoryPage],
  );

  const setActiveChannel = useCallback(
    (channelId: string | null) => {
      activeRef.current = channelId;
      if (channelId) markRead(channelId);
    },
    [markRead],
  );

  const optimistic = useCallback(
    (channelId: string, localId: string, over: Partial<ChatMessage>) => {
      store.dispatch({
        type: 'message/optimistic',
        message: {
          key: `local:${localId}`,
          messageId: null,
          localId,
          channelId,
          senderId: myIdRef.current ?? '',
          sentTime: Date.now(),
          kind: 'text',
          rawType: '',
          direction: 'out',
          status: 'sending',
          needReceipt: true,
          receiptSent: false,
          ...over,
        },
      });
    },
    [store],
  );

  const settle = useCallback(
    (channelId: string, localId: string, res: { isOk: boolean; code: number; data?: Message }, keep?: Partial<ChatMessage>) => {
      if (res.isOk && res.data) store.dispatch({ type: 'message/sent', channelId, localId, message: { ...normalize(res.data), ...keep } });
      else store.dispatch({ type: 'message/failed', channelId, localId, errorCode: res.code });
    },
    [store, normalize],
  );

  const sendText = useCallback(
    (channelId: string, text: string, mentionUserIds: string[]) => {
      const sdk = sdkRef.current;
      if (!sdk) return;
      const localId = newLocalId();
      optimistic(channelId, localId, { kind: 'text', rawType: 'RC:TxtMsg', text, mentionedUserIds: mentionUserIds });
      const send = async () => {
        const params = new sdk.SendTextMessageParams({
          text,
          ...(mentionUserIds.length > 0 && { mentionedInfo: { type: sdk.MentionedType.USERS, userIdList: mentionUserIds } }),
        });
        params.needReceipt = true;
        const res = await new sdk.GroupChannel(channelId).sendMessage(params);
        settle(channelId, localId, res);
        // Backup trigger for the agents (the webhook is the primary one; the server dedupes by messageId).
        if (res.isOk && res.data?.messageId)
          void api.relay({ channelId, messageId: res.data.messageId, text, mentionedUserIds: mentionUserIds }).catch(() => {});
      };
      resend.current.set(localId, send);
      void send().catch(() => store.dispatch({ type: 'message/failed', channelId, localId }));
    },
    [optimistic, settle, store],
  );

  const sendMedia = useCallback(
    (channelId: string, kind: 'image' | 'voice', file: File, durationS = 0, mentionUserIds: string[] = []) => {
      const sdk = sdkRef.current;
      if (!sdk) return;
      const localId = newLocalId();
      const preview = URL.createObjectURL(file);
      optimistic(
        channelId,
        localId,
        kind === 'image'
          ? { kind, rawType: 'RC:ImgMsg', image: { url: preview, thumb: null } }
          : { kind, rawType: 'RC:HQVCMsg', voice: { url: preview, durationS } },
      );
      const send = async () => {
        const made = kind === 'image' ? await sdk.Helper.createSendImageMessageParams(file) : await sdk.Helper.createSendHDVoiceMessageParams(file);
        if (!made.isOk || !made.data) {
          store.dispatch({ type: 'message/failed', channelId, localId, errorCode: made.code });
          return;
        }
        const params = made.data;
        params.needReceipt = true;
        if (kind === 'voice') {
          const content = params.content as { duration?: number; mentionedInfo?: { type: number; userIdList: string[] } };
          if (!content.duration) content.duration = Math.max(1, Math.round(durationS));
          if (mentionUserIds.length > 0) content.mentionedInfo = { type: sdk.MentionedType.USERS, userIdList: mentionUserIds };
        }
        params.onUploadProgress = (p: number) => store.dispatch({ type: 'message/progress', channelId, localId, progress: Math.round(p) });
        const res = await new sdk.GroupChannel(channelId).sendMediaMessage(params as Parameters<BaseChannel['sendMediaMessage']>[0]);
        // Backup trigger for a voice pitch to an agent (the webhook is primary; the server dedupes).
        const remoteUrl = (res.data?.content as { remoteUrl?: string } | undefined)?.remoteUrl;
        if (kind === 'voice' && res.isOk && res.data?.messageId && remoteUrl && mentionUserIds.length > 0)
          void api
            .relay({ channelId, messageId: res.data.messageId, voice: { url: remoteUrl, durationS: Math.round(durationS) }, mentionedUserIds: mentionUserIds })
            .catch(() => {});
        // Keep showing the local file: no flash while the uploaded copy loads.
        settle(channelId, localId, res, kind === 'image' ? { image: { url: preview, thumb: null } } : { voice: { url: preview, durationS } });
      };
      resend.current.set(localId, send);
      void send().catch(() => store.dispatch({ type: 'message/failed', channelId, localId }));
    },
    [optimistic, settle, store],
  );

  const retry = useCallback(
    (channelId: string, localId: string) => {
      const send = resend.current.get(localId);
      if (!send) return;
      store.dispatch({ type: 'message/retry', channelId, localId });
      void send().catch(() => store.dispatch({ type: 'message/failed', channelId, localId }));
    },
    [store],
  );

  const sendTyping = useCallback((channelId: string) => {
    const sdk = sdkRef.current;
    if (!sdk) return;
    void new sdk.GroupChannel(channelId).sendMessage(new sdk.SendMessageParams({ typing: 'text' }, MESSAGE_TYPES.typing)).catch(() => {});
  }, []);

  const watchPresence = useCallback(
    (userIds: string[]) => {
      const sdk = sdkRef.current;
      const fresh = userIds.filter(id => id && id !== myIdRef.current && !subscribed.current.has(id));
      if (!sdk || fresh.length === 0) return;
      for (const id of fresh) subscribed.current.add(id);
      void (async () => {
        for (let i = 0; i < fresh.length; i += 100) {
          const r = await sdk.NCEngine.userModule.subscribeEvent({ userIds: fresh.slice(i, i + 100), subscribeType: sdk.SubscribeType.ONLINE_STATUS });
          if (!r.isOk) console.warn('[nexconn] presence subscribe failed', r.code);
        }
        await refreshPresence(fresh);
      })();
    },
    [refreshPresence],
  );

  const seenBy = useCallback(async (channelId: string, messageId: string): Promise<SeenByUser[]> => {
    const sdk = sdkRef.current;
    if (!sdk) return [];
    const q = sdk.BaseChannel.createMessagesReadReceiptUsersQuery({
      channelIdentifier: new sdk.GroupChannel(channelId).identifier,
      messageId,
      pageSize: 50,
      status: sdk.MessageReadReceiptStatus.RESPONDED,
    });
    const r = await q.loadNextPage();
    return r.isOk && r.data ? r.data.data.map(u => ({ userId: u.userId, timestamp: u.timestamp })) : [];
  }, []);

  const onUnknownChannel = useCallback((fn: (channelId: string) => void) => {
    unknownListeners.current.add(fn);
    return () => void unknownListeners.current.delete(fn);
  }, []);

  const retryConnect = useCallback(() => {
    rejects.current = 0;
    setAttempt(a => a + 1);
  }, []);

  // ---- tap-to-translate: reserve the daily allowance on our server, then ask Nexconn
  const language = user?.language ?? 'en';
  const translateLang = useRef<string | null>(null);
  const translate = useCallback(
    async (messageId: string, text: string): Promise<TranslateOutcome> => {
      const sdk = sdkRef.current;
      const current = translations.get(messageId);
      if (current?.state === 'done' || current?.state === 'pending') return 'ok';
      if (!sdk || !text.trim()) return 'failed';
      translations.set(messageId, { state: 'pending' });
      try {
        const quota = await api.translateQuota(text.length);
        if (!quota.ok) {
          translations.set(messageId, { state: 'error', reason: 'cap' });
          return 'cap';
        }
        if (translateLang.current !== language) {
          await sdk.NCEngine.translateModule.setTranslationLanguage(language);
          translateLang.current = language;
        }
        const done = new Promise<boolean>(resolve => {
          translateWaiters.current.set(messageId, resolve);
          setTimeout(() => resolve(false), 15_000);
        });
        // `text` is required on Web (else error 35060).
        const res = await sdk.NCEngine.translateModule.translateMessages({
          list: [new sdk.TranslateMessageParam(messageId, 'auto', language, text)],
          force: false,
        });
        if (!res.isOk || !(await done)) throw new Error(`translate failed (${res.code})`);
        return 'ok';
      } catch {
        translateWaiters.current.delete(messageId);
        if (translations.get(messageId)?.state !== 'done') translations.set(messageId, { state: 'error', reason: 'failed' });
        return translations.get(messageId)?.state === 'done' ? 'ok' : 'failed';
      }
    },
    [language, translations],
  );
  const translationApi = useMemo<TranslationApi>(() => ({ store: translations, language, translate }), [translations, language, translate]);

  const value = useMemo<NexconnValue>(
    () => ({
      state,
      reconnectedAt,
      myId,
      store,
      presence,
      retryConnect,
      setActiveChannel,
      loadHistory,
      markRead,
      sendText,
      sendImage: (c, f) => sendMedia(c, 'image', f),
      sendVoice: (c, f, d, mentions) => sendMedia(c, 'voice', f, d, mentions),
      retry,
      sendTyping,
      watchPresence,
      seenBy,
      onUnknownChannel,
    }),
    [
      state,
      reconnectedAt,
      myId,
      store,
      presence,
      retryConnect,
      setActiveChannel,
      loadHistory,
      markRead,
      sendText,
      sendMedia,
      retry,
      sendTyping,
      watchPresence,
      seenBy,
      onUnknownChannel,
    ],
  );
  return (
    <NexconnContext.Provider value={value}>
      <TranslationContext.Provider value={translationApi}>{children}</TranslationContext.Provider>
    </NexconnContext.Provider>
  );
}

export function useNexconn(): NexconnValue {
  const ctx = useContext(NexconnContext);
  if (!ctx) throw new Error('useNexconn must be used inside <NexconnProvider>');
  return ctx;
}

// Messages the server posts as agents: text, streamed replies, cards (with live metadata) and
// agent-state status messages. Every agent text is also written to messages_log, so agents see
// their own earlier replies as context even when server-API messages are not sent to webhooks.
import {
  AGENTS,
  BUILTIN_MESSAGE_TYPES,
  CARD_MESSAGE_TYPES,
  cardPreview,
  encodeCard,
  MESSAGE_TYPES,
  metaToStrings,
  nexconnUserId,
  type AgentKey,
  type AgentStateMessage,
  type CardContent,
  type CardKind,
} from '@crewarcade/shared';
import type { Ctx } from '../context';
import { sendGroupMessage, setMessageMetadata } from '../nexconn/api';
import { NexconnApiError, NexconnUnavailableError } from '../nexconn/errors';
import { streamToGroup, type StreamResult } from '../nexconn/stream';
import { insertCard } from '../repo/games';
import { logMessage } from '../repo/webhooks';
import { requireNexconn } from './chat-users';

type PostCtx = Pick<Ctx, 'nexconn' | 'db' | 'log' | 'config' | 'now'>;

const agentNexconnId = (a: AgentKey) => nexconnUserId(AGENTS[a].id);
export const agentPortrait = (ctx: Pick<Ctx, 'config'>, a: AgentKey) => `${ctx.config.WEB_ORIGIN.replace(/\/+$/, '')}${AGENTS[a].avatarPath}`;

async function logAgentText(ctx: PostCtx, channelId: string, messageId: string | null | undefined, agent: AgentKey, messageType: string, text: string | null) {
  if (!messageId) return;
  await logMessage(ctx.db, {
    nexconnMessageId: messageId,
    channelId,
    channelType: 3,
    fromUserId: AGENTS[agent].id,
    messageType,
    text: text?.slice(0, 2000) ?? null,
    createdAt: new Date(ctx.now()),
  }).catch(err => ctx.log.warn({ err }, 'could not log agent message'));
}

export async function postText(ctx: PostCtx, channelId: string, agent: AgentKey, text: string): Promise<string | null> {
  const [sent] = await sendGroupMessage(requireNexconn(ctx), {
    fromUserId: agentNexconnId(agent),
    toChannelIds: [channelId],
    messageType: BUILTIN_MESSAGE_TYPES.text,
    content: JSON.stringify({ content: text }),
    pushContent: `${AGENTS[agent].displayName.split(' ')[0]}: ${text.slice(0, 80)}`,
    shouldPersist: 1,
    isEchoToSender: 0,
  });
  await logAgentText(ctx, channelId, sent?.messageId, agent, BUILTIN_MESSAGE_TYPES.text, text);
  return sent?.messageId ?? null;
}

/** Streams an agent reply (RC:StreamMsg, markdown). Falls back to one text message on failure. */
export async function streamReply(ctx: PostCtx, channelId: string, agent: AgentKey, chunks: AsyncIterable<string>): Promise<StreamResult> {
  const res = await streamToGroup(requireNexconn(ctx), chunks, {
    channelId,
    sender: { id: agentNexconnId(agent), name: AGENTS[agent].displayName, portrait: agentPortrait(ctx, agent) },
    now: ctx.now,
  });
  await logAgentText(ctx, channelId, res.messageId, agent, res.fellBack ? BUILTIN_MESSAGE_TYPES.text : BUILTIN_MESSAGE_TYPES.stream, res.text.trim());
  if (res.fellBack) ctx.log.warn({ channelId, agent, chunks: res.chunks }, 'stream failed; sent the reply as a text message');
  return res;
}

export interface PostCardInput<K extends CardKind> {
  channelId: string;
  agent: AgentKey;
  kind: K;
  content: CardContent<K>;
  metadata: Record<string, unknown>;
  gameId?: string | null;
  version?: number | null;
  /** Server-side card state (the source of truth for votes and status). */
  state?: Record<string, unknown>;
}

/** Sends a card with hasMetadata: true, stores messageId -> card in `cards`, returns the messageId. */
export async function postCard<K extends CardKind>(ctx: PostCtx, input: PostCardInput<K>): Promise<string> {
  const content = encodeCard(input.kind, input.content as never);
  const metadata = metaToStrings(input.metadata);
  const preview = cardPreview({ kind: input.kind, content: input.content } as never);
  const [sent] = await sendGroupMessage(requireNexconn(ctx), {
    fromUserId: agentNexconnId(input.agent),
    toChannelIds: [input.channelId],
    messageType: CARD_MESSAGE_TYPES[input.kind],
    content,
    pushContent: preview.slice(0, 100),
    shouldPersist: 1,
    isEchoToSender: 0,
    hasMetadata: true,
    ...(Object.keys(metadata).length > 0 && { metadata }),
  });
  if (!sent?.messageId) throw new Error('card send returned no messageId');
  await insertCard(ctx.db, {
    nexconnMessageId: sent.messageId,
    channelId: input.channelId,
    cardType: input.kind,
    gameId: input.gameId ?? null,
    version: input.version ?? null,
    state: input.state ?? {},
    createdAt: new Date(ctx.now()),
  });
  await logAgentText(ctx, input.channelId, sent.messageId, input.agent, CARD_MESSAGE_TYPES[input.kind], `[card] ${preview}`);
  return sent.messageId;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Sets card metadata (metadata/set). Values are computed from the DB state, so a retry is safe.
 * Retries (on top of the client's own) for availability errors and rate limits.
 */
export async function updateCard(
  ctx: PostCtx,
  input: { messageId: string; channelId: string; operatorId: string; metadata: Record<string, unknown> },
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<Record<string, string>> {
  const metadata = metaToStrings(input.metadata);
  const attempts = opts.attempts ?? 3;
  for (let i = 1; ; i++) {
    try {
      await setMessageMetadata(requireNexconn(ctx), {
        messageId: input.messageId,
        userId: input.operatorId,
        channelType: 3,
        channelId: input.channelId,
        metadata,
        isEchoToSender: 1,
      });
      return metadata;
    } catch (e) {
      const retryable = e instanceof NexconnUnavailableError || (e instanceof NexconnApiError && (e.code === 1008 || e.httpStatus >= 500));
      if (!retryable || i >= attempts) throw e;
      ctx.log.warn({ messageId: input.messageId, attempt: i }, 'metadata/set failed, retrying');
      await sleep((opts.delayMs ?? 400) * i);
    }
  }
}

/** CA:AgentState: a status message (not stored, not counted, no push, no channel-list update). */
export async function postAgentState(ctx: PostCtx, channelId: string, state: AgentStateMessage): Promise<void> {
  await sendGroupMessage(requireNexconn(ctx), {
    fromUserId: agentNexconnId(state.agentId),
    toChannelIds: [channelId],
    messageType: MESSAGE_TYPES.agentState,
    content: JSON.stringify(state),
    shouldPersist: 0,
    isEchoToSender: 0,
    disablePush: true,
    disableUpdateLastMsg: true,
  });
}

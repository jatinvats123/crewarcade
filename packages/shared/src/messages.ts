// Zod schemas for the non-card custom message payloads (CA:AgentState, CA:Notice, CA:Typing,
// CA:Reaction) and the webhook envelope we receive from Nexconn.
import { z } from 'zod';
import { AGENT_STATES } from './constants';

/** CA:AgentState (status message: online members only, never stored). Sent on every state change
 *  and as a heartbeat every few seconds while an agent works, so late joiners catch up. */
export const AgentStateMessage = z.object({
  v: z.literal(1).default(1),
  agentId: z.enum(['pixel', 'forge', 'glitch']),
  state: z.enum(AGENT_STATES),
  /** Short human text, e.g. "Chai Dash" or "v2". */
  detail: z.string().max(120).default(''),
  /** When this state started (ms), for "building 32s". */
  startedAt: z.number().int().min(0),
  gameId: z.string().max(64).optional(),
  /** e.g. testing 12/18. */
  progress: z.object({ done: z.number().int().min(0), total: z.number().int().min(1) }).optional(),
  /** messageId of a stream reply this agent is writing right now. Web clients are not pushed
   *  server-sent RC:StreamMsg messages (live 2026-11-14), so they fetch it by id and pull it with
   *  requestStreamMessage(). */
  streamId: z.string().max(64).optional(),
});
export type AgentStateMessage = z.infer<typeof AgentStateMessage>;

export const NoticeMessage = z.object({
  kind: z.enum(['welcome', 'member_joined', 'member_left', 'room_created', 'publish_approved', 'publish_blocked', 'budget', 'info', 'shield']),
  text: z.string().min(1).max(300),
  gameId: z.string().max(64).optional(),
});
export type NoticeMessage = z.infer<typeof NoticeMessage>;

/** CA:Typing: what the sender is composing. Transient; receivers clear it after TYPING_TTL_MS. */
export const TypingMessage = z.object({ typing: z.enum(['text', 'voice']).default('text') });
export type TypingMessage = z.infer<typeof TypingMessage>;
/** Senders repeat CA:Typing at most this often while typing (client limit: 5 messages/s overall). */
export const TYPING_THROTTLE_MS = 4000;
/** Receivers hide a typing indicator this long after the last CA:Typing (docs suggest ~6 s). */
export const TYPING_TTL_MS = 6500;

export const ReactionMessage = z.object({
  emoji: z.string().min(1).max(8),
});
export type ReactionMessage = z.infer<typeof ReactionMessage>;

/** Every Nexconn webhook body: {type, id, time, data: [...]}. data items are validated per event type. */
export const WebhookEnvelope = z.object({
  type: z.string().min(1).max(64),
  id: z.string().min(1).max(128),
  time: z.number().int(),
  data: z.array(z.record(z.string(), z.unknown())),
});
export type WebhookEnvelope = z.infer<typeof WebhookEnvelope>;

/** Pre-messaging response: 0 block, 1 allow, 2 allow and skip other callbacks. */
export const PreMessagingResponse = z.object({
  pass: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  replaceContent: z.string().optional(),
  replacePushContent: z.string().optional(),
  replaceMetadata: z.record(z.string().max(32), z.object({ v: z.string().max(4096) })).optional(),
  extra: z.string().max(1024).optional(),
});
export type PreMessagingResponse = z.infer<typeof PreMessagingResponse>;

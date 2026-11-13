// Zod schemas for the non-card custom message payloads (CA:Handoff, CA:AgentState, CA:Notice,
// CA:Reaction) and the webhook envelope we receive from Nexconn.
import { z } from 'zod';
import { AGENT_ID_LIST, AGENT_STATES } from './constants';

const agentId = z.enum(AGENT_ID_LIST as [string, ...string[]]);

export const HandoffMessage = z.object({
  from: agentId,
  to: agentId,
  gameId: z.string().max(64),
  version: z.number().int().min(1).optional(),
  text: z.string().min(1).max(300),
});
export type HandoffMessage = z.infer<typeof HandoffMessage>;

export const AgentStateMessage = z.object({
  agentId,
  state: z.enum(AGENT_STATES),
  gameId: z.string().max(64).optional(),
  /** Short human text, e.g. "building v2 (1:20)". */
  detail: z.string().max(120).optional(),
});
export type AgentStateMessage = z.infer<typeof AgentStateMessage>;

export const NoticeMessage = z.object({
  kind: z.enum(['welcome', 'member_joined', 'member_left', 'room_created', 'publish_approved', 'publish_blocked', 'budget', 'info']),
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

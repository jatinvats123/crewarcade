// Platform Chat API calls CrewArcade uses. Inputs are validated before they leave (Nexconn rules from
// the docs, 2026-11-13); responses are validated by the client. Every user ID passed here must
// already be a Nexconn ID (nexconnUserId()); never a DB ID.
import { isNexconnId, LIMITS } from '@crewarcade/shared';
import { z } from 'zod';
import type { NexconnClient } from './client';
import { NotImplementedYetError } from './errors';

const DOCS = 'https://docs.nexconn.ai';
const nexconnId = z.string().refine(isNexconnId, 'must be letters and digits, at most 64');
const customOrBuiltinType = z.string().min(1).max(32);
const metadata = z.record(z.string().regex(/^[A-Za-z0-9+=\-_]{1,32}$/), z.string().max(LIMITS.metadataValueChars));
const flag = z.union([z.literal(0), z.literal(1)]);

const Ok = z.object({ code: z.literal(0) });
const MessageIds = z.object({
  code: z.literal(0),
  result: z.object({ messageIds: z.array(z.object({ channelId: z.string().optional(), userId: z.string().optional(), messageId: z.string() })) }),
});

// ---- users ---------------------------------------------------------------------------------

export const IssueTokenInput = z.object({
  userId: nexconnId,
  /** Required by Nexconn (push notifications), <= 64 chars. */
  name: z.string().min(1).max(64),
  avatarUrl: z.string().url().max(1024).optional(),
});
const TokenResult = z.object({ code: z.literal(0), result: z.object({ userId: z.string(), accessToken: z.string().min(1).max(256) }) });

/** POST /v4/auth/access-token/issue (200/s). Re-issuing is allowed and overwrites name/avatar. */
export async function issueToken(c: NexconnClient, input: z.input<typeof IssueTokenInput>): Promise<{ userId: string; accessToken: string }> {
  const body = IssueTokenInput.parse(input);
  const res = await c.post('/v4/auth/access-token/issue', body, TokenResult, { bucket: 'token' });
  return res.result;
}

// ---- group channels -------------------------------------------------------------------------

export const GroupPermissions = z.object({
  /** 0 owner approval (default), 1 open, 2 owner/admin approval, 3 nobody. */
  joinPerm: z.number().int().min(0).max(3).optional(),
  removePerm: z.number().int().min(0).max(2).optional(),
  memInvitePerm: z.number().int().min(0).max(2).optional(),
  invitePerm: z.number().int().min(0).max(1).optional(),
  profilePerm: z.number().int().min(0).max(2).optional(),
  memProfilePerm: z.number().int().min(0).max(2).optional(),
});

export const CreateGroupInput = z.object({
  channelId: nexconnId,
  name: z.string().min(1).max(64),
  owner: nexconnId,
  userIds: z.array(nexconnId).max(30).optional(),
  groupProfile: z
    .object({ introduction: z.string().max(512).optional(), announcement: z.string().max(1024).optional(), portraitUrl: z.string().max(128).optional() })
    .optional(),
  permissions: GroupPermissions.optional(),
  groupExtProfile: z
    .record(z.string().regex(/^ext_[A-Za-z0-9_]{1,28}$/), z.string().max(256))
    .refine(o => Object.keys(o).length <= 10, 'at most 10 entries')
    .optional(),
});

/** POST /v4/group-channel/create (100/s). The owner joins automatically. */
export async function createGroup(c: NexconnClient, input: z.input<typeof CreateGroupInput>): Promise<void> {
  await c.post('/v4/group-channel/create', CreateGroupInput.parse(input), Ok);
}

export const JoinGroupInput = z.object({ channelId: nexconnId, userIds: z.array(nexconnId).min(1).max(100) });

/** POST /v4/group-channel/join (100/s). Adds users directly, no approval. */
export async function joinGroup(c: NexconnClient, input: z.input<typeof JoinGroupInput>): Promise<void> {
  await c.post('/v4/group-channel/join', JoinGroupInput.parse(input), z.object({ code: z.literal(0) }).passthrough());
}

/** POST /v4/group-channel/member/kickout-all (100/s): removes a user from every group (account deletion). */
export async function kickOutOfAllGroups(c: NexconnClient, input: { userId: string }): Promise<void> {
  await c.post('/v4/group-channel/member/kickout-all', z.object({ userId: nexconnId }).parse(input), Ok);
}

/** POST /v4/group-channel/dismiss (100/s): deletes a group channel and removes all members. */
export async function dismissGroup(c: NexconnClient, input: { channelId: string }): Promise<void> {
  await c.post('/v4/group-channel/dismiss', z.object({ channelId: nexconnId }).parse(input), Ok);
}

// ---- messages -------------------------------------------------------------------------------

const MessageBase = z.object({
  fromUserId: nexconnId,
  messageType: customOrBuiltinType,
  /** JSON string. <= 10 KB except media/stream types. */
  content: z.string().min(2),
  pushContent: z.string().max(1024).optional(),
  pushData: z.string().max(1024).optional(),
  isEchoToSender: flag.optional(),
  shouldPersist: flag.optional(),
  hasMetadata: z.boolean().optional(),
  metadata: metadata.optional(),
  disablePush: z.boolean().optional(),
  disableUpdateLastMsg: z.boolean().optional(),
  needReadReceipt: flag.optional(),
});

export const SendGroupMessageInput = MessageBase.extend({
  toChannelIds: z.array(nexconnId).min(1).max(3),
  /** Targeted message: only with exactly one channel, and then no metadata/push fields. */
  toUserIds: z.array(nexconnId).min(1).optional(),
  hasMention: flag.optional(),
}).superRefine((m, ctx) => {
  if (/^NC:/.test(m.messageType)) ctx.addIssue({ code: 'custom', message: 'NC: is reserved' });
  if ((m.hasMetadata || m.metadata) && m.toChannelIds.length !== 1) ctx.addIssue({ code: 'custom', message: 'metadata needs exactly one channel' });
  if (m.toUserIds && (m.toChannelIds.length !== 1 || m.hasMetadata || m.metadata || m.disablePush !== undefined))
    ctx.addIssue({ code: 'custom', message: 'targeted messages need one channel and no metadata/push fields' });
  if (
    !/^RC:(ImgMsg|StreamMsg|VcMsg|HQVCMsg|SightMsg|LBSMsg|CombineV2Msg|CombineMsg|ReferenceMsg)$/.test(m.messageType) &&
    new TextEncoder().encode(m.content).length > LIMITS.messageContentBytes
  )
    ctx.addIssue({ code: 'custom', message: 'content exceeds 10 KB' });
});

export interface SentMessage {
  channelId: string;
  messageId: string;
}

/** POST /v4/group-channel/message/send (20 messages/s; 3 channels = 3 messages). */
export async function sendGroupMessage(c: NexconnClient, input: z.input<typeof SendGroupMessageInput>): Promise<SentMessage[]> {
  const body = SendGroupMessageInput.parse(input);
  const res = await c.post('/v4/group-channel/message/send', body, MessageIds, { bucket: 'groupMessage', cost: body.toChannelIds.length });
  return res.result.messageIds.map(m => ({ channelId: m.channelId ?? '', messageId: m.messageId }));
}

export const SendDirectMessageInput = MessageBase.extend({
  toUserIds: z.array(nexconnId).min(1).max(1000),
  verifyBlocklist: flag.optional(),
});

/** POST /v4/direct-channel/message/send (6,000 messages/min; 1,000 recipients = 1,000 messages). */
export async function sendDirectMessage(
  c: NexconnClient,
  input: z.input<typeof SendDirectMessageInput>,
): Promise<Array<{ userId: string; messageId: string }>> {
  const body = SendDirectMessageInput.parse(input);
  const res = await c.post('/v4/direct-channel/message/send', body, MessageIds, { bucket: 'directMessage', cost: body.toUserIds.length });
  return res.result.messageIds.map(m => ({ userId: m.userId ?? '', messageId: m.messageId }));
}

export const SetMetadataInput = z.object({
  messageId: z.string().min(1).max(64),
  /** Operator's Nexconn user ID. */
  userId: nexconnId,
  channelType: z.union([z.literal(1), z.literal(3)]),
  channelId: nexconnId,
  metadata: metadata.refine(m => Object.keys(m).length >= 1 && Object.keys(m).length <= 100, '1-100 entries'),
  isEchoToSender: flag.optional(),
});

/** POST /v4/channel-type/message/metadata/set (100/s; group metadata shares the 20/s group-send quota). */
export async function setMessageMetadata(c: NexconnClient, input: z.input<typeof SetMetadataInput>): Promise<void> {
  const body = SetMetadataInput.parse(input);
  await c.post('/v4/channel-type/message/metadata/set', body, Ok, { bucket: body.channelType === 3 ? 'groupMessage' : 'directMessage' });
}

// ---- later phases: documented, not implemented yet --------------------------------------------

// docs: /platform-chat-api/message/send-group-stream.md (checked 2026-11-14)
export const StreamChunkContent = z
  .object({
    content: z.string(),
    /** Starts at 1, +1 per chunk. */
    seq: z.number().int().min(1),
    complete: z.boolean(),
    completeReason: z.number().int().optional(),
    /** First chunk only: text | markdown | html. */
    type: z.enum(['text', 'markdown', 'html']).optional(),
    /** Continuation chunks: the id returned for chunk 1. */
    messageId: z.string().min(1).max(64).optional(),
    /** First chunk only. */
    user: z.object({ id: z.string(), name: z.string().max(64), portrait: z.string().max(1024).optional() }).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.seq === 1 && c.messageId) ctx.addIssue({ code: 'custom', message: 'the first chunk has no messageId' });
    if (c.seq > 1 && !c.messageId) ctx.addIssue({ code: 'custom', message: 'continuation chunks need the messageId' });
    if (c.seq > 1 && (c.type || c.user)) ctx.addIssue({ code: 'custom', message: 'type and user go on the first chunk only' });
  });

export const StreamGroupMessageInput = z.object({
  fromUserId: nexconnId,
  /** Singular (unlike message/send). */
  toChannelId: nexconnId,
  messageType: z.literal('RC:StreamMsg'),
  /** An object, not a JSON string (unlike message/send). */
  content: StreamChunkContent,
  isEchoToSender: flag.optional(),
  shouldPersist: flag.optional(),
  disableUpdateLastMsg: z.boolean().optional(),
});
const StreamResult = z.object({ code: z.literal(0), result: z.object({ messageId: z.string().optional() }).passthrough().optional() });

/** POST /v4/group-channel/message/stream/send. Returns the messageId for the first chunk. */
export async function streamGroupMessage(c: NexconnClient, input: z.input<typeof StreamGroupMessageInput>): Promise<{ messageId: string | null }> {
  const body = StreamGroupMessageInput.parse(input);
  const res = await c.post('/v4/group-channel/message/stream/send', body, StreamResult, { bucket: 'groupMessage' });
  return { messageId: res.result?.messageId ?? null };
}

/** Phase 3 (Live Build Theater). POST /v4/open-channel/create {channelId, destroyType, ttlMinutes}. */
export async function createOpenChannel(_c: NexconnClient, _input: unknown): Promise<never> {
  throw new NotImplementedYetError('createOpenChannel', `${DOCS}/platform-chat-api/open-channel/create.md`);
}

/** Phase 3. Free plan allows 50 concurrent open channels, so rooms are destroyed when a build ends. */
export async function destroyOpenChannel(_c: NexconnClient, _input: unknown): Promise<never> {
  throw new NotImplementedYetError('destroyOpenChannel', `${DOCS}/platform-chat-api/open-channel/destroy.md`);
}

/** Phase 3. */
export async function sendOpenChannelMessage(_c: NexconnClient, _input: unknown): Promise<never> {
  throw new NotImplementedYetError('sendOpenChannelMessage', `${DOCS}/platform-chat-api/message/open-channel/send-open-channel.md`);
}

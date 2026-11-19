// The safety shield at work, in both modes (rules in shield.ts):
//   - pre-delivery: `preDeliveryDecision` answers Nexconn's *:pre_messaging webhook (pass 0 blocks;
//     the sender sees why through `extra`). Used as soon as pre-messaging is enabled for our App Key.
//   - after-delivery: `shieldIncoming` runs on every message:send before the agents see it. A hit is
//     deleted for everyone (POST /v4/message/delete) within about a second, a 🛡 notice tells the room
//     why, and the agents never act on it.
// Both write moderation_log and the ledger. The /safety page reports which mode is live.
import {
  AGENTS,
  dbUserIdFromNexconn,
  isAgentId,
  newId,
  nexconnUserId,
  parseTextContent,
  BUILTIN_MESSAGE_TYPES,
  type PreMessagingResponse,
} from '@crewarcade/shared';
import type { Ctx } from '../context';
import { getRole } from '../repo/crews';
import { insertModeration } from '../repo/moderation';
import { deleteMessage } from '../nexconn/api';
import { postNotice } from '../services/crews';
import { record } from '../services/ledger';
import { resolveRoom } from '../services/rooms';
import { createTtlCache, type TtlCache } from '../util/ttl-cache';
import { checkMessage, createFloodTracker, isShipCommand, type ShieldHit } from './shield';

export type ShieldCtx = Pick<Ctx, 'db' | 'log' | 'now' | 'nexconn'>;

export interface ShieldMessage {
  messageId: string;
  channelId: string;
  channelType: number;
  /** Nexconn sender id. */
  userId: string;
  messageType: string;
  content: string;
  time?: number;
  os?: string | undefined;
}

interface ShieldState {
  flood: ReturnType<typeof createFloodTracker>;
  /** `${channelId}|${userId}` -> can publish in that crew (60 s). */
  roles: TtlCache<{ crewId: string; canApprove: boolean } | null>;
  /** When the last pre-messaging event arrived (pre-delivery mode is live). */
  lastPreAt: number | null;
}

// One state per database handle (one per app instance; tests get their own).
const states = new WeakMap<object, ShieldState>();
function stateOf(ctx: ShieldCtx): ShieldState {
  let s = states.get(ctx.db);
  if (!s) {
    s = { flood: createFloodTracker(ctx.now), roles: createTtlCache({ ttlMs: 60_000, now: ctx.now }), lastPreAt: null };
    states.set(ctx.db, s);
  }
  return s;
}

/** Which mode protects chats now: pre-delivery once Nexconn sends pre-messaging events (last 24 h). */
export function shieldMode(ctx: ShieldCtx): 'pre-delivery' | 'after-delivery' {
  const at = stateOf(ctx).lastPreAt;
  return at !== null && ctx.now() - at < 24 * 3600_000 ? 'pre-delivery' : 'after-delivery';
}

async function senderRole(ctx: ShieldCtx, channelId: string, userId: string) {
  return stateOf(ctx).roles.get(`${channelId}|${userId}`, async () => {
    const room = await resolveRoom(ctx, channelId);
    if (!room) return null;
    const role = await getRole(ctx.db, room.crew.id, userId);
    return { crewId: room.crew.id, canApprove: role === 'owner' || role === 'approver' };
  });
}

/** Runs the rules on one human text message; null = fine. Only ship commands need the sender's role. */
async function evaluate(ctx: ShieldCtx, m: ShieldMessage, o: { roleTimeoutMs?: number } = {}): Promise<{ hit: ShieldHit; userId: string } | null> {
  const userId = dbUserIdFromNexconn(m.userId);
  if (isAgentId(userId) || m.os === 'Server') return null;
  if (m.messageType !== BUILTIN_MESSAGE_TYPES.text) return null;
  const text = parseTextContent(m.content)?.text ?? '';
  if (!text.trim()) return null;
  const flooding = stateOf(ctx).flood.hit(userId, m.channelId, text, m.messageId || undefined);
  let hit = checkMessage(text, { canApprove: true, flooding });
  if (!hit && isShipCommand(text)) {
    const lookup = senderRole(ctx, m.channelId, userId);
    // Pre-delivery has a 5 s budget shared with Nexconn's retries: never wait long for the DB.
    const role = o.roleTimeoutMs ? await Promise.race([lookup, new Promise<undefined>(r => setTimeout(() => r(undefined), o.roleTimeoutMs))]) : await lookup;
    if (role) hit = checkMessage(text, { canApprove: role.canApprove, flooding });
  }
  return hit ? { hit, userId } : null;
}

async function logHit(ctx: ShieldCtx, m: ShieldMessage, userId: string, hit: ShieldHit, mode: 'pre-delivery' | 'after-delivery', removed: boolean) {
  await insertModeration(ctx.db, {
    id: newId('moderation'),
    channelId: m.channelId,
    userId,
    rule: hit.rule,
    action: 'blocked',
    excerpt: hit.excerpt,
  }).catch(err => ctx.log.error({ err }, 'shield: moderation log failed'));
  const room = await resolveRoom(ctx, m.channelId).catch(() => null);
  if (room)
    await record(ctx, {
      action: 'shield.blocked',
      actor: { type: 'agent', agent: 'glitch' },
      crewId: room.crew.id,
      gameId: room.game?.id ?? null,
      summary: `Glitch's shield stopped a message (${hit.rule.replace('_', ' ')}, ${mode}${mode === 'after-delivery' ? (removed ? ', removed' : ', removal failed') : ''})`,
      input: { rule: hit.rule, excerpt: hit.excerpt, mode },
      reason: hit.rule,
    });
}

async function notify(ctx: ShieldCtx, channelId: string, hit: ShieldHit) {
  if (!ctx.nexconn) return;
  await postNotice(ctx as Ctx, channelId, { kind: 'shield', text: hit.notice }).catch(err => ctx.log.warn({ err }, 'shield: notice failed'));
}

/**
 * After-delivery mode (message:send). Returns the hit when the message was stopped: the caller must
 * not route it to the agents. Removal comes first so it lands within about a second.
 */
export async function shieldIncoming(ctx: ShieldCtx, m: ShieldMessage): Promise<ShieldHit | null> {
  const r = await evaluate(ctx, m);
  if (!r) return null;
  let removed = false;
  if (ctx.nexconn && (m.channelType === 1 || m.channelType === 3)) {
    try {
      await deleteMessage(ctx.nexconn, {
        fromUserId: m.userId,
        channelType: m.channelType,
        channelId: m.channelId,
        messageId: m.messageId,
        ...(m.time && { sentAt: m.time }),
        disablePush: true,
      });
      removed = true;
    } catch (err) {
      ctx.log.warn({ err, messageId: m.messageId }, 'shield: delete failed');
    }
  }
  ctx.log.info({ rule: r.hit.rule, messageId: m.messageId, removed }, 'shield: message stopped after delivery');
  await notify(ctx, m.channelId, r.hit);
  await logHit(ctx, m, r.userId, r.hit, 'after-delivery', removed);
  return r.hit;
}

/**
 * Pre-delivery mode (*:pre_messaging). Answers fast; logging and the room notice run afterwards via
 * `after`. A missing or unreadable payload passes (Nexconn delivers anyway when we time out).
 */
export async function preDeliveryDecision(ctx: ShieldCtx, data: unknown, after: (work: () => Promise<void>) => void): Promise<PreMessagingResponse> {
  stateOf(ctx).lastPreAt = ctx.now();
  const d = data as Partial<ShieldMessage> | undefined;
  if (!d || typeof d.userId !== 'string' || typeof d.channelId !== 'string' || typeof d.messageType !== 'string') return { pass: 1 };
  const m: ShieldMessage = {
    messageId: String(d.messageId ?? ''),
    channelId: d.channelId,
    channelType: Number(d.channelType ?? 3),
    userId: d.userId,
    messageType: d.messageType,
    content: typeof d.content === 'string' ? d.content : '',
    ...(d.os && { os: d.os }),
  };
  const r = await evaluate(ctx, m, { roleTimeoutMs: 400 });
  if (!r) return { pass: 1 };
  after(async () => {
    await notify(ctx, m.channelId, r.hit);
    await logHit(ctx, m, r.userId, r.hit, 'pre-delivery', true);
  });
  return { pass: 0, extra: JSON.stringify({ shield: r.hit.rule, notice: r.hit.notice }).slice(0, 1024) };
}

/** Exported for the agents: who to say the shield is (Glitch). */
export const SHIELD_AGENT = nexconnUserId(AGENTS.glitch.id);

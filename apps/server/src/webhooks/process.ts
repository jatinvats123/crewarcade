// Asynchronous webhook processing (after the 200). Each event type's data items are parsed with zod;
// malformed items are logged and skipped, never fatal. Writes are idempotent.
import { dbUserIdFromNexconn, extractLogText, STATUS_MESSAGE_TYPES, type WebhookEnvelope } from '@crewarcade/shared';
import { z } from 'zod';
import type { Ctx } from '../context';
import { logConnection, logMessage } from '../repo/webhooks';

// docs: /platform-chat-api/webhook/message/send.md
export const MessageSendData = z.object({
  userId: z.string().min(1),
  channelId: z.string().min(1),
  channelType: z.coerce.number().int(),
  messageType: z.string().min(1).max(64),
  content: z.string().default(''),
  time: z.coerce.number().int(),
  messageId: z.string().min(1).max(128),
  os: z.string().optional(),
});

// docs: /platform-chat-api/webhook/user/connection-status.md ("0" connected, "1" disconnected, "2" logged out)
export const ConnectionStatusData = z.object({
  status: z.coerce.string().regex(/^[0-2]$/),
  userId: z.string().min(1),
  os: z.string().optional(),
  time: z.coerce.number().int(),
});

export type ProcessCtx = Pick<Ctx, 'db' | 'log'>;

export async function processWebhook(ctx: ProcessCtx, event: WebhookEnvelope): Promise<{ handled: number; skipped: number }> {
  let handled = 0;
  let skipped = 0;
  switch (event.type) {
    case 'message:send':
      for (const item of event.data) {
        const d = MessageSendData.safeParse(item);
        if (!d.success) {
          skipped++;
          ctx.log.warn({ eventId: event.id, issue: d.error.issues[0]?.message }, 'webhook: bad message:send item');
          continue;
        }
        // Typing, agent states and reactions are signals, not history.
        if (STATUS_MESSAGE_TYPES.has(d.data.messageType)) {
          skipped++;
          continue;
        }
        await logMessage(ctx.db, {
          nexconnMessageId: d.data.messageId,
          channelId: d.data.channelId,
          channelType: d.data.channelType,
          fromUserId: dbUserIdFromNexconn(d.data.userId),
          messageType: d.data.messageType,
          text: extractLogText(d.data.messageType, d.data.content),
          createdAt: new Date(d.data.time),
        });
        handled++;
      }
      break;
    case 'user:connection_status':
      for (const [i, item] of event.data.entries()) {
        const d = ConnectionStatusData.safeParse(item);
        if (!d.success) {
          skipped++;
          ctx.log.warn({ eventId: event.id, issue: d.error.issues[0]?.message }, 'webhook: bad user:connection_status item');
          continue;
        }
        await logConnection(ctx.db, {
          // The event id is the key (idempotent retries); batched items get a suffix.
          eventId: i === 0 ? event.id : `${event.id}:${i}`,
          userId: dbUserIdFromNexconn(d.data.userId),
          status: d.data.status,
          os: d.data.os ?? null,
          at: new Date(d.data.time),
        });
        handled++;
      }
      break;
    default:
      ctx.log.debug({ type: event.type, eventId: event.id, items: event.data.length }, 'webhook: event type not used yet');
  }
  return { handled, skipped };
}

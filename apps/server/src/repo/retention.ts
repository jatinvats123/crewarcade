// Retention (docs/SECURITY.md, the privacy page): chat message logs and connection events are kept
// 30 days, webhook dedupe ids 7 days. Runs at startup and every 6 hours.
import { lt } from 'drizzle-orm';
import { connections, messagesLog, moderationLog, webhookEvents } from '../db/schema';
import type { Db } from '../db/types';

export const MESSAGE_LOG_DAYS = 30;
const DAY = 86_400_000;

export async function purgeExpired(db: Db, now: number): Promise<void> {
  const cutoff = new Date(now - MESSAGE_LOG_DAYS * DAY);
  await db.delete(messagesLog).where(lt(messagesLog.createdAt, cutoff));
  await db.delete(moderationLog).where(lt(moderationLog.createdAt, cutoff));
  await db.delete(connections).where(lt(connections.at, cutoff));
  await db.delete(webhookEvents).where(lt(webhookEvents.receivedAt, new Date(now - 7 * DAY)));
}

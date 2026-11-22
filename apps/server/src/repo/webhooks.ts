// Webhook bookkeeping: dedupe, messages_log, connections. Every insert is idempotent.
import { eq } from 'drizzle-orm';
import type { Db } from '../db/types';
import { connections, messagesLog, users, webhookEvents } from '../db/schema';

/** Claims an event id. false = already seen (a Nexconn retry): skip it. */
export async function claimWebhookEvent(db: Db, id: string, type: string): Promise<boolean> {
  const rows = await db.insert(webhookEvents).values({ id, type }).onConflictDoNothing().returning({ id: webhookEvents.id });
  return rows.length === 1;
}

export async function logMessage(db: Db, row: typeof messagesLog.$inferInsert): Promise<void> {
  await db.insert(messagesLog).values(row).onConflictDoNothing();
}

/** Drops the text of a message the shield stopped, so it never becomes agent context (recentChat). */
export async function clearMessageText(db: Db, nexconnMessageId: string): Promise<void> {
  await db.update(messagesLog).set({ text: null }).where(eq(messagesLog.nexconnMessageId, nexconnMessageId));
}

export async function logConnection(db: Db, row: typeof connections.$inferInsert): Promise<void> {
  await db.insert(connections).values(row).onConflictDoNothing();
  await db.update(users).set({ lastSeenAt: row.at }).where(eq(users.id, row.userId));
}

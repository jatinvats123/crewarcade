// moderation_log: one row per message the safety shield stopped (excerpts are already masked).
import { desc, sql } from 'drizzle-orm';
import { moderationLog } from '../db/schema';
import type { Db } from '../db/types';

export type ModerationRow = typeof moderationLog.$inferSelect;

export async function insertModeration(db: Db, row: typeof moderationLog.$inferInsert): Promise<void> {
  await db.insert(moderationLog).values(row);
}

/** Recent events for the public /safety page: rule, action and time only (no users, no channels). */
export async function recentModeration(db: Db, limit = 20): Promise<Array<Pick<ModerationRow, 'rule' | 'action' | 'createdAt'>>> {
  return db
    .select({ rule: moderationLog.rule, action: moderationLog.action, createdAt: moderationLog.createdAt })
    .from(moderationLog)
    .orderBy(desc(moderationLog.createdAt))
    .limit(limit);
}

/** Events per rule (the log keeps 30 days; see retention.ts). */
export async function moderationCounts(db: Db): Promise<Record<string, number>> {
  const rows = await db
    .select({ rule: moderationLog.rule, n: sql<number>`count(*)::int` })
    .from(moderationLog)
    .groupBy(moderationLog.rule);
  return Object.fromEntries(rows.map(r => [r.rule, Number(r.n)]));
}

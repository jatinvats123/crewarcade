// Bug reports (Phase 5) and the per-user daily translation allowance. Pure data access.
import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { bugs, usage, users } from '../db/schema';
import type { Db } from '../db/types';

export type BugRow = typeof bugs.$inferSelect;

export async function insertBug(db: Db, row: Omit<typeof bugs.$inferInsert, 'number'>): Promise<BugRow> {
  // BUG <n> is per game; the unique-free count is fine (a duplicate number only affects labels).
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bugs)
    .where(eq(bugs.gameId, row.gameId));
  const [b] = await db
    .insert(bugs)
    .values({ ...row, number: (c?.n ?? 0) + 1 })
    .returning();
  return b!;
}

export async function getBug(db: Db, id: string): Promise<BugRow | null> {
  const [b] = await db.select().from(bugs).where(eq(bugs.id, id)).limit(1);
  return b ?? null;
}

export async function updateBug(db: Db, id: string, patch: Partial<typeof bugs.$inferInsert>): Promise<void> {
  await db.update(bugs).set(patch).where(eq(bugs.id, id));
}

/** Bugs whose hotfix is this version (a hotfix fixes one bug; the list keeps it general). */
export async function bugsFixedBy(db: Db, gameId: string, version: number): Promise<BugRow[]> {
  return db
    .select()
    .from(bugs)
    .where(and(eq(bugs.gameId, gameId), eq(bugs.hotfixVersion, version)));
}

/** Credits on /g/<slug>: bugs fixed in a version up to the published one, with the hunter's name. */
export async function bugHunters(db: Db, gameId: string, publishedVersion: number): Promise<Array<{ name: string; bug: string; version: number }>> {
  const rows = await db
    .select({ name: users.displayName, bug: bugs.description, version: bugs.fixedInVersion })
    .from(bugs)
    .innerJoin(users, eq(users.id, bugs.reporterId))
    .where(and(eq(bugs.gameId, gameId), eq(bugs.status, 'fixed'), isNotNull(bugs.fixedInVersion), lte(bugs.fixedInVersion, publishedVersion)))
    .orderBy(asc(bugs.fixedInVersion));
  return rows.map(r => ({ name: r.name, bug: r.bug.slice(0, 120), version: r.version ?? 0 }));
}

// ---- translation allowance ----------------------------------------------------------------------

/** Pure rule: a tap may use `chars` more when the day's total stays within the cap. */
export const canTranslate = (used: number, chars: number, limit: number): boolean => chars > 0 && used + chars <= limit;

/**
 * Reserves `chars` of today's allowance atomically (one statement: concurrent taps can't both slip
 * under the cap). Returns whether it was reserved and the day's total after the attempt.
 */
export async function reserveTranslationChars(db: Db, day: string, userId: string, chars: number, limit: number): Promise<{ ok: boolean; used: number }> {
  if (!canTranslate(0, chars, limit)) return { ok: false, used: await translationCharsOn(db, day, userId) };
  const rows = await db
    .insert(usage)
    .values({ day, userId, translationsChars: chars })
    .onConflictDoUpdate({
      target: [usage.day, usage.userId],
      set: { translationsChars: sql`${usage.translationsChars} + ${chars}` },
      setWhere: sql`${usage.translationsChars} + ${chars} <= ${limit}`,
    })
    .returning({ used: usage.translationsChars });
  if (rows[0]) return { ok: true, used: rows[0].used };
  return { ok: false, used: await translationCharsOn(db, day, userId) };
}

export async function translationCharsOn(db: Db, day: string, userId: string): Promise<number> {
  const [r] = await db
    .select({ n: usage.translationsChars })
    .from(usage)
    .where(and(eq(usage.day, day), eq(usage.userId, userId)));
  return r?.n ?? 0;
}

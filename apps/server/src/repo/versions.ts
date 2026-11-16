// game_versions, scores and challenge throttles.
import { and, desc, eq, gt, isNotNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { challengeDms, games, gameVersions, scores, users } from '../db/schema';
import type { Db } from '../db/types';

export type VersionRow = typeof gameVersions.$inferSelect;

export async function getVersion(db: Db, gameId: string, version: number): Promise<VersionRow | null> {
  const [v] = await db
    .select()
    .from(gameVersions)
    .where(and(eq(gameVersions.gameId, gameId), eq(gameVersions.version, version)))
    .limit(1);
  return v ?? null;
}

export async function updateVersion(db: Db, gameId: string, version: number, patch: Partial<typeof gameVersions.$inferInsert>): Promise<void> {
  await db
    .update(gameVersions)
    .set(patch)
    .where(and(eq(gameVersions.gameId, gameId), eq(gameVersions.version, version)));
}

export async function listVersions(db: Db, gameId: string): Promise<VersionRow[]> {
  return db.select().from(gameVersions).where(eq(gameVersions.gameId, gameId)).orderBy(desc(gameVersions.version));
}

export async function maxVersion(db: Db, gameId: string): Promise<number> {
  const [r] = await db
    .select({ v: sql<number>`coalesce(max(${gameVersions.version}), 0)::int` })
    .from(gameVersions)
    .where(eq(gameVersions.gameId, gameId));
  return r?.v ?? 0;
}

/** The newest version (at most `atMost`) whose HTML exists. */
export async function latestBuiltVersion(db: Db, gameId: string, atMost?: number): Promise<VersionRow | null> {
  const [v] = await db
    .select()
    .from(gameVersions)
    .where(and(eq(gameVersions.gameId, gameId), isNotNull(gameVersions.htmlPath), ...(atMost ? [lte(gameVersions.version, atMost)] : [])))
    .orderBy(desc(gameVersions.version))
    .limit(1);
  return v ?? null;
}

// ---- scores ------------------------------------------------------------------------------------

/** The user's newest score time for a game, for the 1-per-3-s rule. */
export async function lastScoreAt(db: Db, userId: string, gameId: string): Promise<Date | null> {
  const [r] = await db
    .select({ at: scores.createdAt })
    .from(scores)
    .where(and(eq(scores.userId, userId), eq(scores.gameId, gameId)))
    .orderBy(desc(scores.createdAt))
    .limit(1);
  return r?.at ?? null;
}

export async function insertScore(db: Db, row: typeof scores.$inferInsert): Promise<void> {
  await db.insert(scores).values(row);
}

export interface BestRow {
  userId: string;
  score: number;
  version: number;
  at: Date;
  name: string;
  avatarEmoji: string;
  avatarColor: string;
}

/** Best score per player for a game, highest first (ties: who got there first). */
export async function bestScores(db: Db, gameId: string, limit: number): Promise<BestRow[]> {
  const best = db
    .selectDistinctOn([scores.userId], { userId: scores.userId, score: scores.score, version: scores.version, at: scores.createdAt })
    .from(scores)
    .where(eq(scores.gameId, gameId))
    .orderBy(scores.userId, desc(scores.score), scores.createdAt)
    .as('best');
  const rows = await db
    .select({
      userId: best.userId,
      score: best.score,
      version: best.version,
      at: best.at,
      name: users.displayName,
      avatarEmoji: users.avatarEmoji,
      avatarColor: users.avatarColor,
    })
    .from(best)
    .innerJoin(users, eq(users.id, best.userId))
    .orderBy(desc(best.score), best.at)
    .limit(limit);
  return rows;
}

export async function bestOf(db: Db, gameId: string, userId: string): Promise<number | null> {
  const [r] = await db
    .select({ s: sql<number | null>`max(${scores.score})::int` })
    .from(scores)
    .where(and(eq(scores.gameId, gameId), eq(scores.userId, userId)));
  return r?.s ?? null;
}

/** 1 + the number of other players whose best beats `score`. */
export async function rankOf(db: Db, gameId: string, userId: string, score: number): Promise<number> {
  const others = db
    .select({ userId: scores.userId, best: sql<number>`max(${scores.score})`.as('best') })
    .from(scores)
    .where(and(eq(scores.gameId, gameId), ne(scores.userId, userId)))
    .groupBy(scores.userId)
    .as('others');
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(others)
    .where(gt(others.best, score));
  return (r?.n ?? 0) + 1;
}

/**
 * Claims the right to DM `beatenId` about `winnerId` for this hour. Atomic: returns true only for
 * the caller that inserted the row or moved a stale sentAt forward.
 */
export async function claimChallengeDm(db: Db, o: { winnerId: string; beatenId: string; gameId: string; now: Date; intervalMs: number }): Promise<boolean> {
  const cutoff = new Date(o.now.getTime() - o.intervalMs);
  const rows = await db
    .insert(challengeDms)
    .values({ winnerId: o.winnerId, beatenId: o.beatenId, gameId: o.gameId, sentAt: o.now })
    .onConflictDoUpdate({
      target: [challengeDms.winnerId, challengeDms.beatenId],
      set: { sentAt: o.now, gameId: o.gameId },
      setWhere: lt(challengeDms.sentAt, cutoff),
    })
    .returning({ winnerId: challengeDms.winnerId });
  return rows.length > 0;
}

/** Games whose slug or published state the public page needs. */
export async function getGameBySlug(db: Db, slug: string) {
  const [g] = await db.select().from(games).where(eq(games.slug, slug)).limit(1);
  return g ?? null;
}

export async function listRemixes(db: Db, gameId: string) {
  return db
    .select({ slug: games.slug, title: games.title })
    .from(games)
    .where(and(eq(games.remixOfGameId, gameId), or(gt(games.publishedVersion, 0), isNotNull(games.roomChannelId))))
    .orderBy(desc(games.createdAt))
    .limit(12);
}

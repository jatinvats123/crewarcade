// The public Arcade: published games with their published version's look, plays and best score.
import { and, desc, eq, isNotNull, notInArray, sql } from 'drizzle-orm';
import { FIXTURE_GAME_SLUGS, type ArcadeQuery } from '@crewarcade/shared';
import { crews, games, gameVersions, scores } from '../db/schema';
import type { Db } from '../db/types';

export type ArcadeRow = {
  slug: string;
  title: string;
  pitch: string;
  crewName: string;
  version: number;
  meta: Record<string, unknown>;
  screenshotPath: string | null;
  publishedAt: Date;
  plays: number;
  bestScore: number | null;
};

export async function listArcade(db: Db, q: ArcadeQuery): Promise<ArcadeRow[]> {
  const plays = sql<number>`(select count(*)::int from ${scores} where ${scores.gameId} = ${games.id})`;
  const best = sql<number | null>`(select max(${scores.score})::int from ${scores} where ${scores.gameId} = ${games.id})`;
  const publishedAt = sql<Date>`coalesce(${gameVersions.publishedAt}, ${games.createdAt})`;
  return db
    .select({
      slug: games.slug,
      title: games.title,
      pitch: games.pitch,
      crewName: crews.name,
      version: gameVersions.version,
      meta: gameVersions.meta,
      screenshotPath: gameVersions.screenshotPath,
      publishedAt: sql<Date>`${publishedAt}`.mapWith(games.createdAt),
      plays: sql<number>`${plays}`.mapWith(Number),
      bestScore: best,
    })
    .from(games)
    .innerJoin(gameVersions, and(eq(gameVersions.gameId, games.id), eq(gameVersions.version, games.publishedVersion)))
    .innerJoin(crews, eq(crews.id, games.crewId))
    .where(
      // A published game stays listed while a hotfix builds (status moves on; publishedVersion stays live).
      and(isNotNull(games.publishedVersion), isNotNull(gameVersions.htmlPath), notInArray(games.slug, [...FIXTURE_GAME_SLUGS])),
    )
    .orderBy(...(q.sort === 'top' ? [desc(plays), sql`${best} desc nulls last`, desc(publishedAt)] : [desc(publishedAt)]))
    .limit(q.limit);
}

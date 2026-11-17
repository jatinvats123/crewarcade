// Games, versions, cards (Nexconn message -> card state), ledger, usage and recent chat rows.
// Pure data access: no Nexconn, no HTTP.
import type { GameSummary, LedgerEntry } from '@crewarcade/shared';
import { and, asc, desc, eq, gte, ilike, inArray, like, or, sql } from 'drizzle-orm';
import type { Db } from '../db/types';
import { cards, gameVersions, games, ledger, messagesLog, usage, users } from '../db/schema';

export type GameRow = typeof games.$inferSelect;
export type CardRow = typeof cards.$inferSelect;

export function toGameSummary(g: GameRow): GameSummary {
  return {
    id: g.id,
    crewId: g.crewId,
    slug: g.slug,
    title: g.title,
    status: g.status,
    language: g.language,
    roomChannelId: g.roomChannelId,
    remixOfGameId: g.remixOfGameId,
    createdAt: g.createdAt.toISOString(),
  };
}

// ---- games ----------------------------------------------------------------------------------

export async function insertGame(db: Db, row: typeof games.$inferInsert): Promise<GameRow> {
  const [g] = await db.insert(games).values(row).returning();
  if (!g) throw new Error('game insert returned nothing');
  return g;
}

export async function getGame(db: Db, id: string): Promise<GameRow | null> {
  const [g] = await db.select().from(games).where(eq(games.id, id)).limit(1);
  return g ?? null;
}

export async function getGameByRoom(db: Db, channelId: string): Promise<GameRow | null> {
  const [g] = await db.select().from(games).where(eq(games.roomChannelId, channelId)).limit(1);
  return g ?? null;
}

export async function updateGame(
  db: Db,
  id: string,
  patch: Partial<Pick<GameRow, 'title' | 'slug' | 'pitch' | 'status' | 'roomChannelId' | 'language' | 'remixOfGameId' | 'publishedVersion'>>,
): Promise<GameRow | null> {
  const [g] = await db.update(games).set(patch).where(eq(games.id, id)).returning();
  return g ?? null;
}

/** Games of a crew that have a room or are still being planned, newest first. */
export async function listCrewGames(db: Db, crewId: string): Promise<GameRow[]> {
  return db.select().from(games).where(eq(games.crewId, crewId)).orderBy(desc(games.createdAt)).limit(50);
}

/** Slugs already used that start with `base` (for picking base-2, base-3...). */
export async function slugsLike(db: Db, base: string): Promise<Set<string>> {
  const rows = await db
    .select({ slug: games.slug })
    .from(games)
    .where(like(games.slug, `${base}%`));
  return new Set(rows.map(r => r.slug));
}

/** "remix <source> into ...": a game of this crew by slug or title, else a published game anywhere. */
export async function findGameForRemix(db: Db, crewId: string, source: string): Promise<GameRow | null> {
  const s = source.trim().replace(/^["“']|["”']$/g, '');
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const match = or(eq(games.slug, slug), ilike(games.title, s.replace(/[%_]/g, '')));
  // Titles can repeat: an exact slug wins, then a game that was approved (has a room), then the newest.
  const [own] = await db
    .select()
    .from(games)
    .where(and(eq(games.crewId, crewId), match))
    .orderBy(sql`case when ${games.slug} = ${slug} then 0 when ${games.roomChannelId} is not null then 1 else 2 end`, desc(games.createdAt))
    .limit(1);
  if (own) return own;
  const [pub] = await db
    .select()
    .from(games)
    .where(and(eq(games.status, 'published'), match))
    .limit(1);
  return pub ?? null;
}

export async function insertVersion(db: Db, row: typeof gameVersions.$inferInsert): Promise<void> {
  await db.insert(gameVersions).values(row).onConflictDoNothing();
}

// ---- cards ----------------------------------------------------------------------------------

export async function insertCard(db: Db, row: typeof cards.$inferInsert): Promise<void> {
  await db.insert(cards).values(row).onConflictDoNothing();
}

export async function getCard(db: Db, messageId: string): Promise<CardRow | null> {
  const [c] = await db.select().from(cards).where(eq(cards.nexconnMessageId, messageId)).limit(1);
  return c ?? null;
}

/**
 * Read-modify-write of a card's state under a row lock, so two people voting at the same moment
 * cannot overwrite each other. `fn` returns the new state, or null to leave it unchanged.
 */
export async function updateCardState<S extends Record<string, unknown>>(
  db: Db,
  messageId: string,
  fn: (state: S, row: CardRow) => S | null,
): Promise<{ row: CardRow; state: S; changed: boolean } | null> {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(cards).where(eq(cards.nexconnMessageId, messageId)).for('update').limit(1);
    if (!row) return null;
    const next = fn(row.state as S, row);
    if (!next) return { row, state: row.state as S, changed: false };
    await tx.update(cards).set({ state: next }).where(eq(cards.nexconnMessageId, messageId));
    return { row: { ...row, state: next }, state: next, changed: true };
  });
}

/** Latest plan card in a channel still open for votes or changes. */
export async function latestOpenPlan(db: Db, channelId: string): Promise<CardRow | null> {
  const [c] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.channelId, channelId), eq(cards.cardType, 'plan'), sql`${cards.state}->>'status' in ('pending', 'changes_requested')`))
    .orderBy(desc(cards.createdAt))
    .limit(1);
  return c ?? null;
}

/** Latest plan card for a game (approved copy or the voting one). */
export async function latestPlanForGame(db: Db, gameId: string): Promise<CardRow | null> {
  const [c] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.gameId, gameId), eq(cards.cardType, 'plan')))
    .orderBy(desc(cards.createdAt))
    .limit(1);
  return c ?? null;
}

// ---- ledger ---------------------------------------------------------------------------------

export type LedgerInsert = typeof ledger.$inferInsert;

export async function insertLedger(db: Db, row: LedgerInsert): Promise<void> {
  await db.insert(ledger).values(row);
}

type LedgerRowWithName = typeof ledger.$inferSelect & { actorName: string | null };

const ledgerSelect = (db: Db) =>
  db
    .select({
      id: ledger.id,
      gameId: ledger.gameId,
      crewId: ledger.crewId,
      actorType: ledger.actorType,
      actorId: ledger.actorId,
      action: ledger.action,
      summary: ledger.summary,
      input: ledger.input,
      output: ledger.output,
      reason: ledger.reason,
      tokensIn: ledger.tokensIn,
      tokensOut: ledger.tokensOut,
      costUsd: ledger.costUsd,
      ms: ledger.ms,
      createdAt: ledger.createdAt,
      actorName: users.displayName,
    })
    .from(ledger)
    .leftJoin(users, eq(users.id, ledger.actorId));

export async function listLedgerForGame(db: Db, gameId: string, limit = 500): Promise<LedgerRowWithName[]> {
  return ledgerSelect(db).where(eq(ledger.gameId, gameId)).orderBy(asc(ledger.createdAt), asc(ledger.id)).limit(limit);
}

export async function listLedgerForActor(db: Db, crewId: string, actorId: string, limit = 5): Promise<LedgerRowWithName[]> {
  return ledgerSelect(db)
    .where(and(eq(ledger.crewId, crewId), eq(ledger.actorId, actorId)))
    .orderBy(desc(ledger.createdAt), desc(ledger.id))
    .limit(limit);
}

/** Shortens long strings anywhere in a JSON value (display redaction; the DB keeps the stored copy). */
export function redact(value: unknown, maxChars = 600, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > maxChars ? `${value.slice(0, maxChars)}… [${value.length - maxChars} more characters]` : value;
  if (depth > 6) return '…';
  if (Array.isArray(value)) return value.slice(0, 50).map(v => redact(v, maxChars, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, maxChars, depth + 1)]));
  return value;
}

export function toLedgerEntry(r: LedgerRowWithName): LedgerEntry {
  return {
    id: r.id,
    gameId: r.gameId,
    crewId: r.crewId,
    actorType: r.actorType,
    actorId: r.actorId,
    actorName: r.actorName ?? (r.actorType === 'system' ? 'CrewArcade' : 'Someone'),
    action: r.action,
    summary: r.summary,
    input: redact(r.input),
    output: redact(r.output),
    reason: r.reason,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    costUsd: Number(r.costUsd),
    ms: r.ms,
    createdAt: r.createdAt.toISOString(),
  };
}

// ---- usage (daily credits + global budget) ---------------------------------------------------

export const dayOf = (t: number): string => new Date(t).toISOString().slice(0, 10);

export async function addUsageCost(db: Db, day: string, userId: string, costUsd: number): Promise<void> {
  await db
    .insert(usage)
    .values({ day, userId, costUsd })
    .onConflictDoUpdate({ target: [usage.day, usage.userId], set: { costUsd: sql`${usage.costUsd} + ${costUsd}` } });
}

export async function totalCostOn(db: Db, day: string): Promise<number> {
  const [r] = await db
    .select({ total: sql<string>`coalesce(sum(${usage.costUsd}), 0)` })
    .from(usage)
    .where(eq(usage.day, day));
  return Number(r?.total ?? 0);
}

// ---- recent chat (agent context) --------------------------------------------------------------

export interface ChatLine {
  from: string;
  isAgent: boolean;
  text: string;
  at: Date;
}

/** The last `limit` text messages of a channel, oldest first, with sender names. */
export async function recentChat(db: Db, channelId: string, limit = 30, since?: Date): Promise<ChatLine[]> {
  const rows = await db
    .select({ text: messagesLog.text, at: messagesLog.createdAt, name: users.displayName, isAgent: users.isAgent })
    .from(messagesLog)
    .leftJoin(users, eq(users.id, messagesLog.fromUserId))
    .where(and(eq(messagesLog.channelId, channelId), sql`${messagesLog.text} is not null`, ...(since ? [gte(messagesLog.createdAt, since)] : [])))
    .orderBy(desc(messagesLog.createdAt))
    .limit(limit);
  return rows.reverse().map(r => ({ from: r.name ?? 'Someone', isAgent: !!r.isAgent, text: r.text ?? '', at: r.at }));
}

export async function usersByIds(db: Db, ids: string[]): Promise<Map<string, typeof users.$inferSelect>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(users).where(inArray(users.id, ids));
  return new Map(rows.map(u => [u.id, u]));
}

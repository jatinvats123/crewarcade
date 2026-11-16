// Scores and leaderboards. The player reports the game's score hook; the server treats it as a
// claim: plausibility limits (cap, minimum run time, 1 score / 3 s per user and game) before it is
// stored. A new #1, or beating a crew member's best, posts a CA:ScoreCard in the game room and a DM
// from Glitch to each beaten crew member with a [Play again] link (at most 1 per pair per hour).
import {
  AGENTS,
  BUILTIN_MESSAGE_TYPES,
  LIMITS,
  newId,
  nexconnUserId,
  PLAY_RULES,
  type LeaderboardResponse,
  type ScoreBody,
  type ScoreResponse,
} from '@crewarcade/shared';
import type { Config } from '../config';
import type { Ctx } from '../context';
import { sendDirectMessage } from '../nexconn/api';
import { listMembers } from '../repo/crews';
import { getGame, type GameRow } from '../repo/games';
import type { UserRow } from '../repo/users';
import { bestOf, bestScores, claimChallengeDm, getVersion, insertScore, lastScoreAt, rankOf } from '../repo/versions';
import { postCard } from './chat';
import { requireNexconn } from './chat-users';
import { CrewRuleError } from './crews';
import { record } from './ledger';

export type Plausibility = { ok: true } | { ok: false; status: 422 | 429; reason: string };

/** The pure rules, unit-tested on their own. */
export function checkPlausible(
  config: Pick<Config, 'SCORE_MAX' | 'SCORE_MIN_TIME_MS'>,
  s: Pick<ScoreBody, 'score' | 'timeMs'>,
  o: { lastAt: number | null; now: number },
): Plausibility {
  if (o.lastAt !== null && o.now - o.lastAt < PLAY_RULES.scoreIntervalMs) return { ok: false, status: 429, reason: 'One score every 3 seconds, please.' };
  if (s.score > config.SCORE_MAX) return { ok: false, status: 422, reason: 'That score is above the limit for this arcade.' };
  if (s.timeMs < config.SCORE_MIN_TIME_MS) return { ok: false, status: 422, reason: 'That run was too short to count.' };
  return { ok: true };
}

/** Who may see a game's leaderboard / post scores: anyone for published games, else crew members. */
async function access(ctx: Ctx, game: GameRow, user: UserRow | null): Promise<'public' | 'member' | null> {
  if (user) {
    const members = await listMembers(ctx.db, game.crewId);
    if (members.some(m => m.id === user.id)) return 'member';
  }
  return game.publishedVersion ? 'public' : null;
}

export async function leaderboard(ctx: Ctx, gameId: string, user: UserRow | null): Promise<LeaderboardResponse> {
  const game = await getGame(ctx.db, gameId);
  if (!game || !(await access(ctx, game, user))) throw new CrewRuleError(404, 'not_found', 'Game not found');
  const top = await bestScores(ctx.db, game.id, PLAY_RULES.leaderboardSize);
  let me: LeaderboardResponse['me'] = null;
  if (user) {
    const best = await bestOf(ctx.db, game.id, user.id);
    if (best !== null) me = { best, rank: await rankOf(ctx.db, game.id, user.id, best) };
  }
  return {
    gameId: game.id,
    top: top.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      name: r.name,
      avatarEmoji: r.avatarEmoji,
      avatarColor: r.avatarColor,
      score: r.score,
      version: r.version,
      at: r.at.toISOString(),
    })),
    me,
  };
}

/** In-process lock per (user, game): two quick posts cannot both pass the 3 s rule. */
const inFlight = new Set<string>();

export async function submitScore(ctx: Ctx, user: UserRow, body: ScoreBody): Promise<{ status: number; body: ScoreResponse }> {
  const game = await getGame(ctx.db, body.gameId);
  const version = game ? await getVersion(ctx.db, game.id, body.version) : null;
  if (!game || !version?.htmlPath || !(await access(ctx, game, user))) throw new CrewRuleError(404, 'not_found', 'Game not found');
  if (!user.id) throw new CrewRuleError(403, 'forbidden', 'Sign in first');
  const lockKey = `${user.id}|${game.id}`;
  if (inFlight.has(lockKey))
    return { status: 429, body: { accepted: false, reason: 'One score every 3 seconds, please.', best: null, rank: null, newBest: false } };
  inFlight.add(lockKey);
  try {
    const now = ctx.now();
    const last = await lastScoreAt(ctx.db, user.id, game.id);
    const verdict = checkPlausible(ctx.config, body, { lastAt: last ? last.getTime() : null, now });
    const prevBest = await bestOf(ctx.db, game.id, user.id);
    if (!verdict.ok) {
      ctx.log.info({ userId: user.id, gameId: game.id, score: body.score, reason: verdict.reason }, 'score rejected');
      return { status: verdict.status, body: { accepted: false, reason: verdict.reason, best: prevBest, rank: null, newBest: false } };
    }
    // Before inserting: the current #1 and every crew member's best, to see who was just passed.
    const topBefore = (await bestScores(ctx.db, game.id, 1))[0] ?? null;
    const crewBest = await crewBests(ctx, game, user.id);
    await insertScore(ctx.db, {
      id: newId('score'),
      gameId: game.id,
      version: body.version,
      userId: user.id,
      score: body.score,
      timeMs: body.timeMs,
      createdAt: new Date(now),
    });
    const newBest = prevBest === null || body.score > prevBest;
    const best = newBest ? body.score : prevBest;
    const rank = await rankOf(ctx.db, game.id, user.id, best);
    if (newBest) await celebrate(ctx, { game, user, version: body.version, score: body.score, prevBest, rank, topBefore, crewBest });
    return { status: 200, body: { accepted: true, best, rank, newBest } };
  } finally {
    inFlight.delete(lockKey);
  }
}

async function crewBests(ctx: Ctx, game: GameRow, exceptUserId: string): Promise<Array<{ user: { id: string; displayName: string }; best: number }>> {
  const members = (await listMembers(ctx.db, game.crewId)).filter(m => m.id !== exceptUserId && !m.isAgent);
  const out: Array<{ user: { id: string; displayName: string }; best: number }> = [];
  for (const m of members) {
    const b = await bestOf(ctx.db, game.id, m.id);
    if (b !== null) out.push({ user: { id: m.id, displayName: m.displayName }, best: b });
  }
  return out;
}

/** Crew members whose best this score just passed (it was not above theirs before). Highest first. */
export function passedMembers<T extends { best: number }>(crewBest: readonly T[], score: number, prevBest: number | null): T[] {
  const before = prevBest ?? -1;
  return crewBest.filter(c => score > c.best && before <= c.best).sort((a, b) => b.best - a.best);
}

async function celebrate(
  ctx: Ctx,
  o: {
    game: GameRow;
    user: UserRow;
    version: number;
    score: number;
    prevBest: number | null;
    rank: number;
    topBefore: { userId: string; score: number } | null;
    crewBest: Array<{ user: { id: string; displayName: string }; best: number }>;
  },
): Promise<void> {
  const { game, user } = o;
  const tookTop = o.rank === 1 && (!o.topBefore || o.topBefore.userId !== user.id);
  const passed = passedMembers(o.crewBest, o.score, o.prevBest);
  if ((!tookTop && passed.length === 0) || !game.roomChannelId || !ctx.nexconn) return;
  const beaten = passed[0];
  try {
    await postCard(ctx, {
      channelId: game.roomChannelId,
      agent: 'glitch',
      kind: 'score',
      content: {
        v: 1,
        gameId: game.id,
        slug: game.slug,
        title: game.title.slice(0, 60),
        version: o.version,
        playerId: user.id,
        playerName: user.displayName.slice(0, 64),
        score: o.score,
        rank: o.rank,
        ...(beaten && { beatPlayerId: beaten.user.id, beatPlayerName: beaten.user.displayName.slice(0, 64), beatScore: beaten.best }),
      },
      metadata: {},
      gameId: game.id,
      version: o.version,
    });
  } catch (err) {
    ctx.log.warn({ err }, 'score card failed');
  }
  await record(ctx, {
    action: 'score.top',
    actor: { type: 'human', userId: user.id },
    crewId: game.crewId,
    gameId: game.id,
    summary: beaten ? `${user.displayName} beat ${beaten.user.displayName}: ${o.score} (rank #${o.rank})` : `${user.displayName} took #${o.rank}: ${o.score}`,
    output: { score: o.score, rank: o.rank, passed: passed.map(p => p.user.id) },
  });
  for (const p of passed.slice(0, 3)) await challengeDm(ctx, { game, winner: user, beaten: p.user, score: o.score, theirBest: p.best });
}

/** Where [Play again] leads: the public page for published games, else the game room. */
export function playAgainUrl(config: Pick<Config, 'WEB_ORIGIN'>, game: Pick<GameRow, 'slug' | 'crewId' | 'roomChannelId' | 'publishedVersion'>): string {
  const web = config.WEB_ORIGIN.replace(/\/+$/, '');
  if (game.publishedVersion) return `${web}/g/${game.slug}?play=1`;
  return `${web}/crews/${game.crewId}/rooms/${game.roomChannelId}?play=latest`;
}

async function challengeDm(
  ctx: Ctx,
  o: { game: GameRow; winner: UserRow; beaten: { id: string; displayName: string }; score: number; theirBest: number },
): Promise<void> {
  const claimed = await claimChallengeDm(ctx.db, {
    winnerId: o.winner.id,
    beatenId: o.beaten.id,
    gameId: o.game.id,
    now: new Date(ctx.now()),
    intervalMs: PLAY_RULES.challengeDmIntervalMs,
  });
  if (!claimed) return;
  const link = playAgainUrl(ctx.config, o.game);
  const text = `🔥 ${o.winner.displayName} just beat your best in ${o.game.title}: ${o.score} vs your ${o.theirBest}. Take it back?\n▶ Play again: ${link}`;
  try {
    await sendDirectMessage(requireNexconn(ctx), {
      fromUserId: nexconnUserId(AGENTS.glitch.id),
      toUserIds: [nexconnUserId(o.beaten.id)],
      messageType: BUILTIN_MESSAGE_TYPES.text,
      content: JSON.stringify({ content: text.slice(0, LIMITS.chatTextChars) }),
      pushContent: `Glitch: ${o.winner.displayName} beat your best in ${o.game.title}`.slice(0, 100),
      shouldPersist: 1,
      isEchoToSender: 0,
    });
    await record(ctx, {
      action: 'score.challenge',
      actor: { type: 'agent', agent: 'glitch' },
      crewId: o.game.crewId,
      gameId: o.game.id,
      summary: `Glitch dared ${o.beaten.displayName} to beat ${o.winner.displayName}'s ${o.score}`,
      output: { to: o.beaten.id, link },
    });
  } catch (err) {
    ctx.log.warn({ err }, 'challenge DM failed');
  }
}

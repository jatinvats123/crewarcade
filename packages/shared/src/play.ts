// Playing games: the messages a game iframe may send to the player (docs/ENGINE.md "Score hook"),
// the score/leaderboard API and the public game page. Browser-safe.
import { z } from 'zod';
import { GAME_STATUSES } from './constants';

/**
 * What the starter engine posts to its parent. Everything else is ignored. The score is a claim:
 * the server re-checks it (plausibility limits) before it reaches a leaderboard.
 */
export const GameHostMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('crewarcade:start') }).strict(),
  z
    .object({
      type: z.literal('crewarcade:score'),
      score: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      best: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      /** Seconds in the run. */
      time: z
        .number()
        .finite()
        .min(0)
        .max(24 * 3600),
    })
    .strict(),
]);
export type GameHostMessage = z.infer<typeof GameHostMessage>;

/** Parses a postMessage payload; null for anything that is not exactly a score-hook message. */
export function parseGameHostMessage(data: unknown): GameHostMessage | null {
  const r = GameHostMessage.safeParse(data);
  return r.success ? r.data : null;
}

export const PLAY_RULES = {
  /** At most one score per user and game this often. */
  scoreIntervalMs: 3000,
  /** At most one challenge DM per (winner, beaten player) pair this often. */
  challengeDmIntervalMs: 60 * 60 * 1000,
  leaderboardSize: 20,
} as const;

// ---- play URLs ---------------------------------------------------------------------------

/** GET /api/games/:id/versions/:version/play: a URL the player iframe can load. */
export const PlayUrlResponse = z.object({
  url: z.string().url(),
  /** ms epoch; null for published versions (no token needed). */
  expiresAt: z.number().int().nullable(),
  gameId: z.string(),
  slug: z.string(),
  title: z.string(),
  version: z.number().int().min(1),
  /** The spec's orientation hint, for the rotate prompt. */
  orientation: z.enum(['landscape', 'portrait', 'any']),
});
export type PlayUrlResponse = z.infer<typeof PlayUrlResponse>;

// ---- scores ------------------------------------------------------------------------------

export const ScoreBody = z.object({
  gameId: z.string().min(1).max(64),
  version: z.number().int().min(1),
  score: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  timeMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 3600 * 1000),
});
export type ScoreBody = z.infer<typeof ScoreBody>;

export const ScoreResponse = z.object({
  accepted: z.boolean(),
  /** Why a score was not recorded (too fast, implausible). */
  reason: z.string().optional(),
  best: z.number().int().nullable(),
  rank: z.number().int().nullable(),
  newBest: z.boolean(),
});
export type ScoreResponse = z.infer<typeof ScoreResponse>;

export const LeaderboardEntry = z.object({
  rank: z.number().int().min(1),
  userId: z.string(),
  name: z.string(),
  avatarEmoji: z.string(),
  avatarColor: z.string(),
  score: z.number().int(),
  version: z.number().int(),
  at: z.string(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;

export const LeaderboardResponse = z.object({
  gameId: z.string(),
  top: z.array(LeaderboardEntry),
  me: z.object({ best: z.number().int(), rank: z.number().int().min(1) }).nullable(),
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponse>;

// ---- versions and the public game page ----------------------------------------------------

export const GameVersionSummary = z.object({
  version: z.number().int().min(1),
  status: z.string(),
  sizeBytes: z.number().int().nullable(),
  buildMs: z.number().int().nullable(),
  notes: z.array(z.string()),
  published: z.boolean(),
  createdAt: z.string(),
});
export type GameVersionSummary = z.infer<typeof GameVersionSummary>;

export const GameVersionsResponse = z.object({ gameId: z.string(), versions: z.array(GameVersionSummary) });
export type GameVersionsResponse = z.infer<typeof GameVersionsResponse>;

const Avatar = z.object({ name: z.string(), avatarEmoji: z.string(), avatarColor: z.string() });

/** GET /api/public/games/:slug (no sign-in). Drafts show only the teaser fields. */
export const GamePageResponse = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  pitch: z.string(),
  status: z.enum(GAME_STATUSES),
  language: z.string(),
  emoji: z.string(),
  /** Two theme colours from the plan's look and feel (hex), for the title card. */
  colors: z.tuple([z.string(), z.string()]),
  publishedVersion: z.number().int().nullable(),
  /** Glitch's mid-game screenshot of the published version (link previews), if any. */
  screenshotUrl: z.string().url().nullable().default(null),
  /** Play URL of the published version (null for drafts). */
  playUrl: z.string().url().nullable(),
  orientation: z.enum(['landscape', 'portrait', 'any']),
  crew: z.object({ name: z.string(), members: z.array(Avatar) }),
  remixOf: z.object({ slug: z.string(), title: z.string() }).nullable(),
  remixes: z.array(z.object({ slug: z.string(), title: z.string() })),
  versions: z.array(GameVersionSummary),
  /** Players whose bug reports led to a hotfix in a published version (Phase 5). */
  bugHunters: z.array(z.object({ name: z.string(), bug: z.string(), version: z.number().int() })).default([]),
  createdAt: z.string(),
});
export type GamePageResponse = z.infer<typeof GamePageResponse>;

export const RemixBody = z
  .object({
    /** An existing crew of the caller (owner/approver/member), or a new crew name. */
    crewId: z.string().min(1).max(64).optional(),
    newCrewName: z.string().trim().min(1).max(40).optional(),
    idea: z.string().trim().max(280).optional(),
  })
  .refine(b => !!b.crewId !== !!b.newCrewName, 'Pick a crew or name a new one');
export type RemixBody = z.infer<typeof RemixBody>;

/** Pixel's remix plan then appears in this crew's chat. */
export const RemixResponse = z.object({ crewId: z.string(), channelId: z.string() });
export type RemixResponse = z.infer<typeof RemixResponse>;

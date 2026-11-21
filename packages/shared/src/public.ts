// Public, no-login endpoints for judges and visitors (no personal data): /safety.
import { z } from 'zod';

/** GET /api/public/safety: how the shield works and what it stopped (rule + time only). */
export const SafetyResponse = z.object({
  /** pre-delivery: Nexconn pre-messaging blocks before anyone sees it; after-delivery: removed within ~1 s. */
  mode: z.enum(['pre-delivery', 'after-delivery']),
  rules: z.array(z.object({ rule: z.string(), label: z.string(), what: z.string(), count: z.number().int().min(0) })),
  recent: z.array(z.object({ rule: z.string(), at: z.string() })),
  /** Days the moderation log is kept. */
  retentionDays: z.number().int(),
});
export type SafetyResponse = z.infer<typeof SafetyResponse>;

const count = z.number().int().min(0);

/** The steps of the loop, in order, for the "from pitch to Arcade" funnel. */
export const IMPACT_FUNNEL_STEPS = ['pitched', 'approved', 'built', 'passed', 'published', 'played'] as const;

/**
 * GET /api/public/impact: live usage from real people only (agents, judges, the team's own accounts
 * and deleted users are left out). Aggregates and published game titles only: no names, no text.
 */
export const ImpactResponse = z.object({
  updatedAt: z.string(),
  people: z.object({
    signedUp: count,
    active24h: count,
    active7d: count,
    /** Where sign-ups came from (`?ref=` codes); codes with fewer than 2 people are grouped as "other". */
    byReferrer: z.array(z.object({ referrer: z.string(), people: count })),
  }),
  crews: z.object({ total: count, withFriends: count }),
  games: z.object({ made: count, published: count, plays: count, players: count, bugsFixed: count }),
  funnel: z.array(z.object({ step: z.enum(IMPACT_FUNNEL_STEPS), games: count })),
  /** Last 7 days, India Standard Time, oldest first. */
  daily: z.array(z.object({ day: z.string(), signups: count, games: count })),
  /** How the agents did over the last 30 days, on every game (the team's too). */
  agents: z.object({
    playtests: count,
    passed: count,
    medianBuildMs: count.nullable(),
    medianTestMs: count.nullable(),
    aiCostPerGameUsd: z.number().min(0).nullable(),
  }),
  /** Published games made by real crews, most played first. */
  arcade: z.array(z.object({ slug: z.string(), title: z.string(), plays: count })),
  /** What was left out, so the numbers can be read honestly. */
  excluded: z.object({ teamAccounts: count, judgeAccounts: count, teamGames: count }),
});
export type ImpactResponse = z.infer<typeof ImpactResponse>;

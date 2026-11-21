// Public impact numbers (/impact): live usage from real people only. A "real" person is a human
// account that is not a judge, not on the team (TEAM_USER_IDS) and not the deleted-user placeholder.
// Aggregates only, plus the titles of published games (already public in the Arcade).
import { IMPACT_FUNNEL_STEPS, type ImpactResponse } from '@crewarcade/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/types';
import { DELETED_USER_ID } from '../services/account';
import { list, rows, STAGE_ACTIONS } from './admin';

const DAY_MS = 86_400_000;
/** India Standard Time, as a fixed offset (no time-zone database needed). */
const IST_MINUTES = 330;
const DAILY_DAYS = 7;
const AGENT_WINDOW_DAYS = 30;
/** Referrer codes with fewer people than this are grouped as "other" (codes are user-typed). */
const MIN_REFERRER_PEOPLE = 2;
const ALWAYS_SHOWN_REFERRERS = new Set(['direct', 'invite']);

const n = (v: unknown): number => Math.round(Number(v ?? 0)) || 0;
const nullableMs = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v)));

/** YYYY-MM-DD of a moment in India Standard Time. */
export const istDay = (t: number): string => new Date(t + IST_MINUTES * 60_000).toISOString().slice(0, 10);

/** The last `days` IST days, oldest first, ending today. */
export function lastIstDays(now: number, days = DAILY_DAYS): string[] {
  return Array.from({ length: days }, (_, i) => istDay(now - (days - 1 - i) * DAY_MS));
}

/** Small referrer codes become "other", so a typed code can't put arbitrary text on a public page. */
export function groupReferrers(byCode: readonly { referrer: string; people: number }[]): { referrer: string; people: number }[] {
  const kept: { referrer: string; people: number }[] = [];
  let other = 0;
  for (const r of byCode) {
    if (r.people >= MIN_REFERRER_PEOPLE || ALWAYS_SHOWN_REFERRERS.has(r.referrer)) kept.push(r);
    else other += r.people;
  }
  if (other > 0) kept.push({ referrer: 'other', people: other });
  return kept.sort((a, b) => b.people - a.people || a.referrer.localeCompare(b.referrer));
}

export async function impactStats(db: Db, o: { teamIds: readonly string[]; now: number }): Promise<ImpactResponse> {
  const team = o.teamIds.filter(Boolean);
  const notTeam = team.length ? sql`and u.id not in (${list(team)})` : sql``;
  // Every query starts from the same set of real people.
  const real = sql`real as (
    select u.id, u.created_at, u.last_seen_at, coalesce(u.referrer, 'direct') as referrer
    from users u
    where u.is_agent = false and u.is_judge = false and u.id <> ${DELETED_USER_ID} ${notTeam}
  )`;
  const at = (ms: number) => new Date(ms).toISOString();
  const istDate = (col: SQL) => sql`to_char((${col} at time zone 'UTC') + interval '${sql.raw(String(IST_MINUTES))} minutes', 'YYYY-MM-DD')`;
  const days = lastIstDays(o.now);
  const firstDayStart = Date.parse(`${days[0]}T00:00:00Z`) - IST_MINUTES * 60_000;
  const agentSince = at(o.now - AGENT_WINDOW_DAYS * DAY_MS);

  const [people, referrers, crews, games, plays, dailySignups, dailyGames, agents, arcade, excluded] = await Promise.all([
    rows<{ total: unknown; d1: unknown; d7: unknown }>(
      db,
      sql`with ${real} select count(*) as total,
            count(*) filter (where last_seen_at >= ${at(o.now - DAY_MS)}) as d1,
            count(*) filter (where last_seen_at >= ${at(o.now - 7 * DAY_MS)}) as d7
          from real`,
    ),
    rows<{ referrer: string; people: unknown }>(db, sql`with ${real} select referrer, count(*) as people from real group by 1`),
    rows<{ total: unknown; friends: unknown }>(
      db,
      sql`with ${real}, humans as (
            select c.id, (select count(*) from crew_members m join real r on r.id = m.user_id where m.crew_id = c.id) as people
            from crews c
          )
          select count(*) filter (where people >= 1) as total, count(*) filter (where people >= 2) as friends from humans`,
    ),
    rows<Record<string, unknown>>(
      db,
      // A game that got built was approved first, even if it has no room of its own (remixes, old rows).
      sql`with ${real}, mine as (
            select g.*, (g.status in ('built', 'awaiting_approval', 'published')
              or exists (select 1 from game_versions v where v.game_id = g.id and v.status in ('testing', 'passed', 'failed', 'published'))) as is_built
            from games g join real r on r.id = g.created_by
          )
          select count(*) as pitched,
            count(*) filter (where room_channel_id is not null or is_built) as approved,
            count(*) filter (where is_built) as built,
            count(*) filter (where exists (select 1 from game_versions v where v.game_id = mine.id and v.status in ('passed', 'published')))
              as passed,
            count(*) filter (where published_version is not null) as published,
            count(*) filter (where exists (select 1 from scores s join real r on r.id = s.user_id where s.game_id = mine.id)) as played
          from mine`,
    ),
    rows<{ plays: unknown; players: unknown; fixed: unknown }>(
      db,
      sql`with ${real} select
            (select count(*) from scores s join real r on r.id = s.user_id) as plays,
            (select count(distinct s.user_id) from scores s join real r on r.id = s.user_id) as players,
            (select count(*) from bugs b join real r on r.id = b.reporter_id where b.status = 'fixed') as fixed`,
    ),
    rows<{ day: string; c: unknown }>(
      db,
      sql`with ${real} select ${istDate(sql`created_at`)} as day, count(*) as c from real
          where created_at >= ${at(firstDayStart)} group by 1`,
    ),
    rows<{ day: string; c: unknown }>(
      db,
      sql`with ${real} select ${istDate(sql`g.created_at`)} as day, count(*) as c from games g join real r on r.id = g.created_by
          where g.created_at >= ${at(firstDayStart)} group by 1`,
    ),
    rows<{ passed: unknown; failed: unknown; build_ms: unknown; test_ms: unknown; cost: unknown; built: unknown }>(
      db,
      sql`select
            count(*) filter (where action in (${list(STAGE_ACTIONS.test.ok)})) as passed,
            count(*) filter (where action in (${list(STAGE_ACTIONS.test.failed)})) as failed,
            percentile_cont(0.5) within group (order by ms) filter (where action in (${list(STAGE_ACTIONS.build.ok)}) and ms is not null) as build_ms,
            percentile_cont(0.5) within group (order by ms)
              filter (where action in (${list([...STAGE_ACTIONS.test.ok, ...STAGE_ACTIONS.test.failed])}) and ms is not null) as test_ms,
            coalesce(sum(cost_usd) filter (where actor_type = 'agent'), 0) as cost,
            count(distinct game_id) filter (where action in (${list(STAGE_ACTIONS.build.ok)})) as built
          from ledger where created_at >= ${agentSince}`,
    ),
    rows<{ slug: string; title: string; plays: unknown }>(
      db,
      sql`with ${real} select g.slug, g.title, (select count(*) from scores s join real p on p.id = s.user_id where s.game_id = g.id) as plays
          from games g join real r on r.id = g.created_by
          where g.published_version is not null
          order by plays desc, g.created_at desc limit 8`,
    ),
    rows<{ team: unknown; judges: unknown; team_games: unknown }>(
      db,
      sql`select
            ${team.length ? sql`(select count(*) from users where id in (${list(team)}))` : sql`0`} as team,
            (select count(*) from users where is_judge = true) as judges,
            ${team.length ? sql`(select count(*) from games where created_by in (${list(team)}))` : sql`0`} as team_games`,
    ),
  ]);

  const p = people[0] ?? { total: 0, d1: 0, d7: 0 };
  const c = crews[0] ?? { total: 0, friends: 0 };
  const g = games[0] ?? {};
  const pl = plays[0] ?? { plays: 0, players: 0, fixed: 0 };
  const a = agents[0] ?? { passed: 0, failed: 0, build_ms: null, test_ms: null, cost: 0, built: 0 };
  const ex = excluded[0] ?? { team: 0, judges: 0, team_games: 0 };
  const signupsByDay = new Map(dailySignups.map(r => [r.day, n(r.c)]));
  const gamesByDay = new Map(dailyGames.map(r => [r.day, n(r.c)]));
  const built = n(a.built);

  return {
    updatedAt: new Date(o.now).toISOString(),
    people: {
      signedUp: n(p.total),
      active24h: n(p.d1),
      active7d: n(p.d7),
      byReferrer: groupReferrers(referrers.map(r => ({ referrer: r.referrer, people: n(r.people) }))),
    },
    crews: { total: n(c.total), withFriends: n(c.friends) },
    games: { made: n(g.pitched), published: n(g.published), plays: n(pl.plays), players: n(pl.players), bugsFixed: n(pl.fixed) },
    funnel: IMPACT_FUNNEL_STEPS.map(step => ({ step, games: n(g[step]) })),
    daily: days.map(day => ({ day, signups: signupsByDay.get(day) ?? 0, games: gamesByDay.get(day) ?? 0 })),
    agents: {
      playtests: n(a.passed) + n(a.failed),
      passed: n(a.passed),
      medianBuildMs: nullableMs(a.build_ms),
      medianTestMs: nullableMs(a.test_ms),
      aiCostPerGameUsd: built > 0 ? Math.round((Number(a.cost) / built) * 10_000) / 10_000 : null,
    },
    arcade: arcade.map(r => ({ slug: r.slug, title: r.title, plays: n(r.plays) })),
    excluded: { teamAccounts: n(ex.team), judgeAccounts: n(ex.judges), teamGames: n(ex.team_games) },
  };
}

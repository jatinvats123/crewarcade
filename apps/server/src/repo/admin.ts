// Owner dashboard queries (/admin): ledger stages, cost, signups by referrer.
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/types';

/** Ledger actions per stage. Latency uses every row of the stage that has `ms`. */
export const STAGE_ACTIONS = {
  plan: { ok: ['plan.created', 'plan.revised'], failed: ['plan.failed', 'plan.refused'] },
  build: { ok: ['build.ready'], failed: ['build.failed', 'build.check_failed'] },
  test: { ok: ['test.passed'], failed: ['test.failed'] },
} as const;
type Stage = keyof typeof STAGE_ACTIONS;

/** Raw SQL rows on either driver (postgres.js returns an array, PGlite `{ rows }`). */
async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  const r = (await db.execute(query)) as unknown;
  return Array.isArray(r) ? (r as T[]) : (r as { rows: T[] }).rows;
}

const list = (xs: readonly string[]) => sql.join(xs.map(x => sql`${x}`), sql`, `);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function stageStats(db: Db, since: Date) {
  const out = [];
  for (const stage of Object.keys(STAGE_ACTIONS) as Stage[]) {
    const a = STAGE_ACTIONS[stage];
    const [r] = await rows<{ ok: number; failed: number; p50: unknown; p95: unknown }>(
      db,
      sql`select
            count(*) filter (where action in (${list(a.ok)}))::int as ok,
            count(*) filter (where action in (${list(a.failed)}))::int as failed,
            percentile_cont(0.5) within group (order by ms) filter (where ms is not null) as p50,
            percentile_cont(0.95) within group (order by ms) filter (where ms is not null) as p95
          from ledger
          where created_at >= ${since.toISOString()} and action in (${list([...a.ok, ...a.failed])})`,
    );
    out.push({ stage, ok: Number(r?.ok ?? 0), failed: Number(r?.failed ?? 0), p50Ms: num(r?.p50), p95Ms: num(r?.p95) });
  }
  return out;
}

export async function costPerDay(db: Db, since: Date) {
  const rs = await rows<{ day: string; cost: unknown; steps: number }>(
    db,
    sql`select to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
               coalesce(sum(cost_usd), 0) as cost, count(*)::int as steps
        from ledger where created_at >= ${since.toISOString()} and actor_type = 'agent'
        group by 1 order by 1 desc`,
  );
  return rs.map(r => ({ day: r.day, costUsd: Number(r.cost), steps: Number(r.steps) }));
}

export async function signupStats(db: Db, since: Date) {
  const [tot] = await rows<{ total: number; recent: number }>(
    db,
    sql`select count(*)::int as total, count(*) filter (where created_at >= ${since.toISOString()})::int as recent
        from users where is_agent = false`,
  );
  const by = await rows<{ referrer: string; users: number }>(
    db,
    sql`select coalesce(referrer, 'direct') as referrer, count(*)::int as users
        from users where is_agent = false group by 1 order by 2 desc, 1 limit 30`,
  );
  return { total: Number(tot?.total ?? 0), last30: Number(tot?.recent ?? 0), byReferrer: by.map(r => ({ referrer: r.referrer, users: Number(r.users) })) };
}

export async function gameStats(db: Db) {
  const [r] = await rows<{ total: number; published: number; plays: number }>(
    db,
    sql`select (select count(*)::int from games) as total,
               (select count(*)::int from games where published_version is not null) as published,
               (select count(*)::int from scores) as plays`,
  );
  return { total: Number(r?.total ?? 0), published: Number(r?.published ?? 0), plays: Number(r?.plays ?? 0) };
}

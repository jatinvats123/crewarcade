'use client';

// Owner dashboard: stage failures and latency from the ledger, cost per day, queue depth, signups by
// referrer. The server answers 404 unless the signed-in user is in ADMIN_USER_IDS.
import type { AdminStats } from '@crewarcade/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ErrorState, Skeleton } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';

const secs = (ms: number | null) => (ms === null ? '—' : ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);
const usd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;

export function AdminView() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'hidden' | 'error'>('loading');
  const load = useCallback(() => {
    setState('loading');
    api.adminStats().then(
      s => {
        setStats(s);
        setState('ready');
      },
      e => setState(e instanceof ApiRequestError && (e.status === 404 || e.status === 401) ? 'hidden' : 'error'),
    );
  }, []);
  useEffect(load, [load]);

  if (state === 'hidden')
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <h1 className="font-display text-2xl font-bold">Not found</h1>
          <Link href="/" className="mt-3 inline-flex min-h-11 items-center font-semibold text-brand">
            Go home
          </Link>
        </div>
      </main>
    );

  return (
    <main className="pb-safe mx-auto flex min-h-dvh max-w-4xl flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">Admin</h1>
        <button type="button" onClick={load} className="min-h-11 rounded-2xl border border-border px-4 text-sm font-semibold hover:bg-surface-2">
          Refresh
        </button>
      </header>

      {state === 'error' && <ErrorState title="Couldn't load the stats" onRetry={load} />}
      {state === 'loading' && !stats && (
        <div className="grid gap-3 sm:grid-cols-3" aria-busy>
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}

      {stats && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Totals">
            <Tile label="Users" value={stats.signups.total} sub={`${stats.signups.last30} in ${stats.windowDays} days`} />
            <Tile label="Games" value={stats.games.total} sub={`${stats.games.published} published`} />
            <Tile label="Plays" value={stats.games.plays} />
            <Tile label="Cost (14 days)" value={usd(stats.costPerDay.reduce((a, d) => a + d.costUsd, 0))} />
          </section>

          <Section title={`Stages (last ${stats.windowDays} days)`}>
            <Table head={['Stage', 'OK', 'Failed', 'p50', 'p95']} rows={stats.stages.map(s => [s.stage, s.ok, s.failed, secs(s.p50Ms), secs(s.p95Ms)])} />
            <p className="text-xs text-dim">Test “failed” means Glitch found a bug in the game, not a crash. Latency is per step, from the ledger.</p>
          </Section>

          <Section title="Queue">
            {stats.queue ? (
              <Table head={['Queue', 'Waiting', 'Running']} rows={Object.entries(stats.queue).map(([k, v]) => [k, v.queued, v.active])} />
            ) : (
              <p className="text-sm text-dim">The agents don&apos;t run on this server.</p>
            )}
          </Section>

          <Section title="Signups by referrer (all time)">
            <Table head={['Referrer', 'Users']} rows={stats.signups.byReferrer.map(r => [r.referrer, r.users])} />
          </Section>

          <Section title="Cost per day (agents, UTC)">
            {stats.costPerDay.length === 0 ? (
              <p className="text-sm text-dim">No agent steps in the last 14 days.</p>
            ) : (
              <Table head={['Day', 'Steps', 'Cost']} rows={stats.costPerDay.map(d => [d.day, d.steps, usd(d.costUsd)])} />
            )}
          </Section>
        </>
      )}
    </main>
  );
}

function Tile({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p className="text-sm text-dim">{label}</p>
      <p className="font-display text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-dim">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-2">
          <tr>
            {head.map(h => (
              <th key={h} scope="col" className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-2 ${j > 0 ? 'tabular-nums' : 'break-all'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

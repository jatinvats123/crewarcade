import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { fetchSafety } from '@/lib/public-api';

// Public: how Glitch's safety shield protects every crew chat, and what it stopped lately.
export const metadata: Metadata = {
  title: 'Safety',
  description: 'How the CrewArcade safety shield stops prompt injection, abuse, spam and unauthorised ship commands.',
  alternates: { canonical: '/safety' },
};
export const revalidate = 30;

function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export default async function SafetyPage() {
  const data = await fetchSafety();
  const now = Date.now();
  const label = new Map(data?.rules.map(r => [r.rule, r.label]) ?? []);
  const total = data?.rules.reduce((n, r) => n + r.count, 0) ?? 0;
  return (
    <div className="min-h-dvh bg-bg">
      <header className="pt-safe mx-auto flex max-w-2xl items-center px-4 py-3">
        <Link href="/" aria-label="CrewArcade home" className="min-h-11 content-center">
          <Logo className="text-xl" />
        </Link>
      </header>
      <main className="pb-safe mx-auto flex max-w-2xl flex-col gap-7 px-4 pb-12">
        <div>
          <h1 className="font-poster text-4xl tracking-wide uppercase">Safety shield</h1>
          <p className="mt-1 text-dim">
            Three AI agents sit in every crew chat, so every message is checked before the agents act on it. Nothing goes public until an approver taps Allow.
          </p>
        </div>

        <section className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs font-bold tracking-[0.14em] text-dim uppercase">Mode now</p>
          {!data ? (
            <p className="mt-1 text-dim">The server is waking up. Reload in a minute.</p>
          ) : data.mode === 'pre-delivery' ? (
            <p className="mt-1 text-lg font-bold">Pre-delivery: stopped messages never reach the room (Nexconn pre-messaging webhook).</p>
          ) : (
            <p className="mt-1 text-lg font-bold">
              After-delivery: a stopped message is deleted for everyone within about a second, and the agents never act on it.
            </p>
          )}
          <p className="mt-2 text-sm text-dim">
            The same rules run in both modes. Pre-delivery turns on by itself once Nexconn&rsquo;s pre-messaging webhook is enabled for our app.
          </p>
        </section>

        <Section title="What it stops">
          <ul className="flex flex-col gap-3">
            {(data?.rules ?? []).map(r => (
              <li key={r.rule} className="flex items-start justify-between gap-4 border-b border-border pb-3">
                <div>
                  <p className="font-bold">{r.label}</p>
                  <p className="text-sm text-dim">{r.what}</p>
                </div>
                <span className="shrink-0 rounded-full bg-surface-2 px-3 py-1 text-sm font-bold tabular-nums" title="Stopped in the last 30 days">
                  {r.count}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={`Recent events (${total} in ${data?.retentionDays ?? 30} days)`}>
          {data && data.recent.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {data.recent.map((e, i) => (
                <li key={`${e.at}-${i}`} className="flex justify-between gap-4">
                  <span>{label.get(e.rule) ?? e.rule}</span>
                  <span className="text-dim tabular-nums">{ago(e.at, now)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-dim">Nothing stopped yet.</p>
          )}
          <p className="text-xs text-dim">Only the rule and the time are public. Who sent it and what it said stay private (masked excerpts, kept 30 days).</p>
        </Section>

        <Section title="Also enforced on the server">
          <ul className="list-disc space-y-1 pl-5">
            <li>Only owners and approvers can approve plans and tap Allow to publish. Every action is role-checked on the server, not in the app.</li>
            <li>Chat text reaches the AI only inside marked &ldquo;untrusted&rdquo; blocks, and agents never take orders from it.</li>
            <li>Games run in a locked-down sandbox (no network, no cookies, no navigation) and pass a static check before anyone plays them.</li>
            <li>Every agent step and human decision goes into the Decision Ledger, with inputs, tokens and cost.</li>
          </ul>
        </Section>
        <p className="text-sm text-dim">
          See also{' '}
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
          .
        </p>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 text-[0.95rem] leading-relaxed">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

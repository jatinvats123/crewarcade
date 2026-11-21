import type { ImpactResponse } from '@crewarcade/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { ThemeToggle } from '@/components/brand/ThemeToggle';
import { barWidth, dayLabel, duration, FUNNEL_TEXT, istTime, percent, referrerLabel, usdWithRupees } from '@/lib/impact';
import { fetchImpact, impactJsonUrl } from '@/lib/public-api';

// Public live numbers: real people, real crews, real games. Server-rendered from the database every
// minute; the team's own accounts, judges and the three agents are left out (see "How we count").
export const metadata: Metadata = {
  title: 'Live numbers',
  description: 'Real crews, real games: live CrewArcade usage from real people, recomputed every minute.',
  alternates: { canonical: '/impact' },
};
export const revalidate = 60;

const PILL = 'inline-flex min-h-12 items-center justify-center rounded-full px-7 text-sm font-bold tracking-[0.12em] whitespace-nowrap uppercase';

export default async function ImpactPage() {
  const data = await fetchImpact();
  return (
    <div className="min-h-dvh overflow-x-clip bg-bg">
      <header className="pt-safe mx-auto flex max-w-5xl items-center justify-between gap-3 px-safe py-4 md:px-8">
        <Link href="/" aria-label="CrewArcade home" className="min-h-11 content-center">
          <Logo className="text-xl" />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] uppercase">
          <Link href="/arcade" className="inline-flex min-h-11 items-center px-3 text-dim hover:text-text">
            Arcade
          </Link>
          <span className="hidden min-[360px]:inline-flex">
            <ThemeToggle />
          </span>
        </nav>
      </header>

      <main className="pb-safe mx-auto flex max-w-5xl flex-col gap-12 px-safe pb-16 md:px-8">
        <section aria-labelledby="impact-title" className="pt-4 md:pt-10">
          <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-brand uppercase">Live numbers · real people only</p>
          <h1 id="impact-title" className="font-poster text-[clamp(3.25rem,12vw,9rem)] leading-[0.95] uppercase">
            Real crews.
            <br />
            Real games.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-text/75">
            Straight from our database, recomputed every minute. The team&rsquo;s own accounts, judges and the three agents are left out, so these numbers are
            smaller and truer than the App Key&rsquo;s user count.
          </p>
          <p className="mt-3 text-sm text-dim">
            {data ? <>Updated {istTime(data.updatedAt)} · </> : null}
            <a href={impactJsonUrl()} className="underline underline-offset-2 hover:text-text">
              Raw numbers (JSON)
            </a>
          </p>
        </section>

        {!data ? (
          <p className="rounded-2xl border border-border bg-surface p-5 text-dim">The server is waking up. Reload in a minute.</p>
        ) : (
          <>
            <Totals data={data} />
            <Funnel data={data} />
            <div className="grid gap-12 md:grid-cols-2">
              <Daily data={data} />
              <Referrers data={data} />
            </div>
            <MadeByCrews data={data} />
            <Agents data={data} />
          </>
        )}

        <HowWeCount data={data} />

        <div className="flex flex-wrap gap-3">
          <Link href="/start" className={`${PILL} bg-brand text-brand-ink hover:brightness-110`}>
            Make a game
          </Link>
          <Link href="/arcade" className={`${PILL} border border-text/25 hover:border-brand hover:text-brand`}>
            Play the Arcade
          </Link>
        </div>
      </main>
    </div>
  );
}

function Tile({ value, label, sub, accent = false }: { value: number | string; label: string; sub?: string; accent?: boolean }) {
  return (
    <div
      className={`flex min-w-0 flex-col justify-between gap-2 rounded-[22px] border p-4 md:gap-3 md:p-5 ${accent ? 'border-brand bg-brand text-brand-ink' : 'border-border bg-surface'}`}
    >
      <p className={`text-[11px] font-bold tracking-[0.12em] uppercase md:text-xs ${accent ? 'text-brand-ink/80' : 'text-dim'}`}>{label}</p>
      <p className="font-poster text-5xl leading-none tabular-nums md:text-6xl">{value}</p>
      {sub && <p className={`text-xs md:text-sm ${accent ? 'text-brand-ink/80' : 'text-dim'}`}>{sub}</p>}
    </div>
  );
}

function Totals({ data }: { data: ImpactResponse }) {
  const { people, crews, games } = data;
  return (
    <section aria-label="Totals" className="grid grid-cols-2 gap-3 md:grid-cols-3">
      <Tile accent value={people.signedUp} label="People signed up" sub={`${people.active24h} active today · ${people.active7d} this week`} />
      <Tile value={crews.total} label="Crews" sub={`${crews.withFriends} with two or more friends`} />
      <Tile value={games.made} label="Games pitched" sub="by real crews, in their own chats" />
      <Tile value={games.published} label="In the Arcade" sub="published after an approver tapped Allow" />
      <Tile value={games.plays} label="Plays" sub={`by ${games.players} ${games.players === 1 ? 'player' : 'players'}`} />
      <Tile value={games.bugsFixed} label="Bugs fixed" sub="reported by players, reproduced by Glitch, fixed by Forge" />
    </section>
  );
}

function Section({ title, kicker, children }: { title: string; kicker?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        {kicker && <p className="text-xs font-semibold tracking-[0.2em] text-brand uppercase">{kicker}</p>}
        <h2 className="font-poster text-4xl leading-none uppercase md:text-5xl">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Funnel({ data }: { data: ImpactResponse }) {
  const top = data.funnel[0]?.games ?? 0;
  return (
    <Section kicker="The whole loop, on real games" title="From pitch to Arcade">
      <ol className="flex flex-col gap-3">
        {data.funnel.map(f => (
          <li key={f.step} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5">
            <p className="min-w-0">
              <span className="font-bold">{FUNNEL_TEXT[f.step].label}</span> <span className="text-dim">· {FUNNEL_TEXT[f.step].what}</span>
            </p>
            <p className="text-right font-bold tabular-nums">
              {f.games} <span className="text-sm font-normal text-dim">({percent(f.games, top)}%)</span>
            </p>
            <div className="col-span-2 h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full bg-brand" style={{ width: barWidth(f.games, top) }} />
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Daily({ data }: { data: ImpactResponse }) {
  const max = Math.max(1, ...data.daily.flatMap(d => [d.signups, d.games]));
  return (
    <Section kicker="Last 7 days, India time" title="Each day">
      <div className="flex items-center gap-4 text-xs text-dim">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-brand" aria-hidden /> Sign-ups
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-glitch" aria-hidden /> Games pitched
        </span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {data.daily.map(d => (
          <li key={d.day} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 text-sm">
            <span className="text-dim tabular-nums">{dayLabel(d.day)}</span>
            <span className="flex flex-col gap-1">
              <Bar value={d.signups} max={max} tone="bg-brand" label="sign-ups" />
              <Bar value={d.games} max={max} tone="bg-glitch" label="games" />
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Bar({ value, max, tone, label }: { value: number; max: number; tone: string; label: string }) {
  return (
    <span className="flex items-center gap-2" aria-label={`${value} ${label}`}>
      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className={`block h-full rounded-full ${tone}`} style={{ width: barWidth(value, max) }} />
      </span>
      <span className="w-6 text-right text-xs tabular-nums" aria-hidden>
        {value}
      </span>
    </span>
  );
}

function Referrers({ data }: { data: ImpactResponse }) {
  const max = Math.max(1, ...data.people.byReferrer.map(r => r.people));
  return (
    <Section kicker="Shared in group chats" title="Where people came from">
      {data.people.byReferrer.length === 0 ? (
        <p className="text-dim">No sign-ups yet.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {data.people.byReferrer.map(r => (
            <li key={r.referrer} className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 text-sm">
              <span className="truncate text-dim">{referrerLabel(r.referrer)}</span>
              <Bar value={r.people} max={max} tone="bg-brand" label="people" />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-dim">
        Every invite link carries a code, so sign-ups are counted by the chat they came from. Rare codes are grouped as &ldquo;other&rdquo;.
      </p>
    </Section>
  );
}

function MadeByCrews({ data }: { data: ImpactResponse }) {
  return (
    <Section kicker="Tap one to play" title="Made by real crews">
      {data.arcade.length === 0 ? (
        <p className="text-dim">No games published by real crews yet.</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
          {data.arcade.map(g => (
            <li key={g.slug} className="min-w-0">
              <Link
                href={`/g/${g.slug}`}
                className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 hover:border-brand"
              >
                <span className="min-w-0 truncate font-bold">{g.title}</span>
                <span className="shrink-0 text-sm text-dim tabular-nums">
                  {g.plays} {g.plays === 1 ? 'play' : 'plays'} ▶
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Agents({ data }: { data: ImpactResponse }) {
  const a = data.agents;
  return (
    <Section kicker="Last 30 days, every game" title="The agents at work">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile value={a.playtests} label="Playtests run" sub={`${a.passed} passed (${percent(a.passed, a.playtests)}%) in headless Chromium`} />
        <Tile value={duration(a.medianBuildMs)} label="Median build" sub="Forge writing a whole game" />
        <Tile value={duration(a.medianTestMs)} label="Median playtest" sub="Glitch playing it, with a GIF" />
        <Tile
          value={a.aiCostPerGameUsd === null ? '–' : `$${a.aiCostPerGameUsd.toFixed(2)}`}
          label="AI cost per game"
          sub={usdWithRupees(a.aiCostPerGameUsd)}
        />
      </div>
      <p className="text-xs text-dim">
        A failed playtest is Glitch doing its job: the game goes back to Forge with the failing checks. These numbers include the team&rsquo;s own test games.
      </p>
    </Section>
  );
}

function HowWeCount({ data }: { data: ImpactResponse | null }) {
  const ex = data?.excluded;
  return (
    <Section title="How we count">
      <ul className="flex flex-col gap-2 text-[0.95rem]">
        <li>
          <span className="font-bold">A person</span> is someone who signed in on their own device. <span className="font-bold">Active</span> means they used
          the app in the last 24 hours or 7 days.
        </li>
        <li>
          <span className="font-bold">A crew</span> counts once a real person is in it. <span className="font-bold">A play</span> is a score set by a real
          person.
        </li>
        <li>Days follow India Standard Time. Numbers are recomputed at most once a minute.</li>
      </ul>
      <p className="mt-2 text-xs font-bold tracking-[0.14em] text-dim uppercase">Never counted</p>
      <ul className="flex flex-col gap-1.5 text-[0.95rem]">
        <li>
          ✕ The team&rsquo;s own accounts{ex ? ` (${ex.teamAccounts})` : ''} and the games they made{ex ? ` (${ex.teamGames})` : ''}.
        </li>
        <li>✕ Judge accounts{ex ? ` (${ex.judgeAccounts})` : ''}.</li>
        <li>✕ Pixel, Forge and Glitch, and accounts their owners deleted.</li>
      </ul>
      <p className="text-xs text-dim">Only totals and the titles of published games are public. Names, chats and pitches stay private.</p>
    </Section>
  );
}

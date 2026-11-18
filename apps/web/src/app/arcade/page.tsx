import type { ArcadeGame } from '@crewarcade/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { ThemeToggle } from '@/components/brand/ThemeToggle';
import { EmptyState, ErrorState } from '@/components/ui';
import { compact, fetchArcade } from '@/lib/arcade';

// The public Arcade: games crews made and published (an approver tapped Allow). Newest or top.
// Outside the signed-in layout: no session, no chat SDK, server-rendered and cached for a minute.
export const metadata: Metadata = {
  title: 'Arcade',
  description: 'Games made by friends with Pixel, Forge & Glitch. Tap one to play.',
  alternates: { canonical: '/arcade' },
};

type Props = { searchParams: Promise<{ sort?: string }> };

export default async function ArcadePage({ searchParams }: Props) {
  const sort = (await searchParams).sort === 'top' ? 'top' : 'new';
  const data = await fetchArcade(sort);
  return (
    <div className="min-h-dvh bg-bg">
      <header className="pt-safe mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" aria-label="CrewArcade home" className="min-h-11 content-center">
          <Logo className="text-xl" />
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/start" className="min-h-11 content-center rounded-2xl px-3 text-sm font-semibold text-brand">
            Make a game
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="pb-safe mx-auto flex max-w-5xl flex-col gap-5 px-4 pb-10">
        <div>
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Arcade</h1>
          <p className="mt-1 text-dim">Games friends made with Pixel, Forge &amp; Glitch. Tap one to play.</p>
        </div>

        <nav aria-label="Sort games" className="flex gap-2">
          {(['new', 'top'] as const).map(s => (
            <Link
              key={s}
              href={s === 'new' ? '/arcade' : '/arcade?sort=top'}
              aria-current={s === sort ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${
                s === sort ? 'border-brand bg-brand text-brand-ink' : 'border-border bg-surface hover:bg-surface-2'
              }`}
            >
              {s === 'new' ? '✨ Newest' : '🏆 Top'}
            </Link>
          ))}
        </nav>

        {!data ? (
          <ErrorState title="Couldn't load the Arcade">
            The server may be waking up (about a minute on the free plan).{' '}
            <Link href={sort === 'top' ? '/arcade?sort=top' : '/arcade'} className="font-semibold text-brand underline">
              Try again
            </Link>
          </ErrorState>
        ) : data.games.length === 0 ? (
          <EmptyState
            emoji="🕹️"
            title="No games here yet"
            action={
              <Link href="/start" className="inline-flex min-h-11 items-center rounded-2xl bg-brand px-5 font-semibold text-brand-ink">
                Start a crew
              </Link>
            }
          >
            Make one with your friends: pitch it in the chat, approve the plan, play it, then tap Allow to publish.
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="arcade-list">
            {data.games.map((g, i) => (
              <li key={g.slug}>
                <ArcadeCard game={g} rank={sort === 'top' ? i + 1 : null} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function ArcadeCard({ game, rank }: { game: ArcadeGame; rank: number | null }) {
  const [c1, c2] = game.colors;
  const stats = [game.plays > 0 ? `${compact(game.plays)} ${game.plays === 1 ? 'play' : 'plays'}` : 'New', game.bestScore !== null ? `best ${compact(game.bestScore)}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <Link
      href={`/g/${game.slug}`}
      className="flex h-full min-w-0 items-start gap-3 rounded-card border border-border bg-surface p-3 transition-colors hover:bg-surface-2"
      style={{ backgroundImage: `linear-gradient(135deg, transparent 55%, ${c1}22 100%)` }}
    >
      <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-4xl" style={{ border: `3px solid ${c2}` }} aria-hidden>
        {game.emoji}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 font-display text-lg leading-snug font-bold break-words">
          {rank !== null && <span className="text-dim">#{rank} </span>}
          {game.title}
        </span>
        <span className="line-clamp-2 text-sm break-words text-dim">{game.pitch}</span>
        <span className="mt-1 truncate text-xs text-faint">
          {game.crewName} · {stats}
        </span>
      </span>
    </Link>
  );
}

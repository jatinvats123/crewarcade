'use client';
/* eslint-disable @next/next/no-img-element -- game screenshots come from our API at any size */

import type { ArcadeGame } from '@crewarcade/shared';
import Link from 'next/link';
import { mix, RIM, WHITE } from '@/components/landing/glass';
import { useReveal } from '@/components/landing/useReveal';
import { compact } from '@/lib/arcade';
import { cn } from '@/lib/cn';
import { GameScene } from './GameScene';

/**
 * The Arcade's games as poster cards: a cover that looks like the game (its screenshot, or a little game
 * scene in its own two colours that starts scrolling on hover), the title in the poster font, plays, best score and crew. The first game
 * is the wide featured card. Cards drift in on scroll; hover lifts the card and shows Play.
 */

function Cover({ game, featured, rank }: { game: ArcadeGame; featured: boolean; rank: number | null }) {
  const [c1] = game.colors;
  return (
    <div
      className={cn('relative overflow-hidden rounded-[28px]', featured ? 'aspect-[16/10] lg:aspect-auto lg:h-full lg:min-h-[420px]' : 'aspect-[4/3]')}
      style={{ background: c1 }}
    >
      {game.screenshotUrl ? (
        <img
          src={game.screenshotUrl}
          alt=""
          className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
        />
      ) : (
        <GameScene
          seed={game.slug}
          emoji={game.emoji}
          colors={game.colors}
          score={game.bestScore}
          best={game.bestScore}
          motion="hover"
          className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-[1.03]"
        />
      )}
      {/* Light on the cover, and the glass rim. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `linear-gradient(160deg, ${mix(WHITE, 22)}, transparent 40%)` }}
      />
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[28px]" style={RIM} />

      {rank !== null && (
        <span className="absolute top-4 left-4 rounded-full bg-black/70 px-3 py-1 font-poster text-xl leading-none text-brand backdrop-blur-md">#{rank}</span>
      )}
      {featured && rank === null && (
        <span className="absolute top-4 left-4 -rotate-3 bg-brand px-2.5 py-1 text-[11px] font-bold tracking-[0.2em] text-brand-ink uppercase">Newest</span>
      )}
      <span className="absolute right-4 bottom-4 translate-y-3 rounded-full bg-brand px-5 py-2.5 text-xs font-bold tracking-[0.18em] text-brand-ink uppercase opacity-0 shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
        ▶ Play
      </span>
    </div>
  );
}

function Card({ game, index, rank }: { game: ArcadeGame; index: number; rank: number | null }) {
  const featured = index === 0;
  const { ref, shown } = useReveal<HTMLLIElement>(0.15);
  const stats = [
    game.plays > 0 ? `${compact(game.plays)} ${game.plays === 1 ? 'play' : 'plays'}` : 'New',
    game.bestScore !== null ? `Best ${compact(game.bestScore)}` : null,
  ].filter(Boolean);

  return (
    <li
      ref={ref}
      className={cn(
        'transition-all duration-700 ease-out',
        featured && 'sm:col-span-2 lg:col-span-3',
        shown ? 'translate-y-0 opacity-100 blur-0' : 'translate-y-12 opacity-0 blur-sm',
      )}
      style={{ transitionDelay: `${(index % 3) * 90}ms` }}
    >
      <Link
        href={`/g/${game.slug}`}
        data-tour="arcade-game"
        className={cn(
          'group flex h-full flex-col gap-5 transition-transform duration-300 ease-out hover:-translate-y-1.5',
          featured && 'lg:grid lg:grid-cols-[1.35fr_1fr] lg:items-center lg:gap-10',
        )}
      >
        <Cover game={game} featured={featured} rank={rank} />
        <div className="min-w-0 px-1">
          <p className={cn('line-clamp-2 font-poster leading-[0.95] break-words uppercase', featured ? 'text-5xl lg:text-7xl' : 'text-3xl')}>{game.title}</p>
          <p className={cn('mt-3 line-clamp-2 break-words text-text/70', featured && 'lg:text-lg')}>{game.pitch}</p>
          <div className="mt-4 flex min-w-0 items-center gap-2 text-[11px] font-semibold tracking-[0.16em] uppercase">
            {stats.map(s => (
              <span key={s} className="shrink-0 rounded-full border border-text/20 px-2.5 py-1 text-text/80">
                {s}
              </span>
            ))}
            <span className="min-w-0 truncate text-text/50">{game.crewName}</span>
          </div>
        </div>
      </Link>
    </li>
  );
}

export function ArcadeGrid({ games, ranked }: { games: ArcadeGame[]; ranked: boolean }) {
  return (
    <ul className="grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3" data-testid="arcade-list">
      {games.map((g, i) => (
        <Card key={g.slug} game={g} index={i} rank={ranked ? i + 1 : null} />
      ))}
    </ul>
  );
}

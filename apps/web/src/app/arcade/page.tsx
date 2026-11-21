import type { Metadata } from 'next';
import Link from 'next/link';
import { ArcadeGrid } from '@/components/arcade/ArcadeGrid';
import { Logo } from '@/components/brand/Logo';
import { JoystickMark } from '@/components/brand/marks';
import { ThemeToggle } from '@/components/brand/ThemeToggle';
import { fetchArcade } from '@/lib/arcade';
import { cn } from '@/lib/cn';

// The public Arcade: games crews made and published (an approver tapped Allow). Newest or top.
// Outside the signed-in layout: no session, no chat SDK, server-rendered and cached for a minute.
export const metadata: Metadata = {
  title: 'Arcade',
  description: 'Games made by friends with Pixel, Forge & Glitch. Tap one to play.',
  alternates: { canonical: '/arcade' },
};

type Props = { searchParams: Promise<{ sort?: string }> };

const TAPE = 'PLAY → REMIX → SHARE → BEAT THE BEST SCORE → ';

function PosterState({ title, children, action }: { title: string; children: React.ReactNode; action: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-6 border-y border-text/12 py-16">
      <p className="font-poster text-5xl leading-[0.9] uppercase md:text-7xl">{title}</p>
      <p className="max-w-lg text-lg text-text/70">{children}</p>
      {action}
    </div>
  );
}

const PILL = 'inline-flex min-h-12 items-center justify-center rounded-full px-7 text-sm font-bold tracking-[0.12em] whitespace-nowrap uppercase';

export default async function ArcadePage({ searchParams }: Props) {
  const sort = (await searchParams).sort === 'top' ? 'top' : 'new';
  const data = await fetchArcade(sort);
  const here = sort === 'top' ? '/arcade?sort=top' : '/arcade';

  return (
    <div className="min-h-dvh overflow-x-clip bg-bg">
      <header className="pt-safe mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-safe py-4 md:px-10 xl:px-16">
        <Link href="/" aria-label="CrewArcade home" className="min-h-11 content-center">
          <Logo className="text-xl" />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-2 text-xs font-semibold tracking-[0.18em] uppercase">
          <Link href="/" className="hidden min-h-11 items-center px-3 text-dim hover:text-text sm:inline-flex">
            Home
          </Link>
          <Link
            href="/start"
            className="inline-flex min-h-11 items-center rounded-full bg-brand px-3 tracking-[0.1em] whitespace-nowrap text-brand-ink hover:brightness-110 sm:px-5 sm:tracking-[0.18em]"
          >
            Make a game
          </Link>
          <span className="hidden min-[360px]:inline-flex">
            <ThemeToggle />
          </span>
        </nav>
      </header>

      <section aria-labelledby="arcade-title" className="mx-auto max-w-[1500px] px-safe pt-8 md:px-10 md:pt-14 xl:px-16">
        <JoystickMark className="mb-6 h-14 w-auto" />
        <p className="mb-4 text-xs font-semibold tracking-[0.2em] text-brand uppercase">Made by crews · free to play · no install</p>
        <h1 id="arcade-title" className="font-poster text-[clamp(4.5rem,17vw,16rem)] leading-[0.82] uppercase">
          The Arcade
        </h1>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-md text-lg text-text/70">Games friends made with Pixel, Forge &amp; Glitch. Tap one to play, then beat the best score.</p>
          <nav aria-label="Sort games" className="inline-flex rounded-full border border-text/15 bg-text/5 p-1">
            {(['new', 'top'] as const).map(s => (
              <Link
                key={s}
                href={s === 'new' ? '/arcade' : '/arcade?sort=top'}
                aria-current={s === sort ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full px-6 text-xs font-bold tracking-[0.18em] uppercase transition-colors',
                  s === sort ? 'bg-brand text-brand-ink' : 'text-text/70 hover:text-text',
                )}
              >
                {s === 'new' ? 'Newest' : 'Top'}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      {/* The lime tape, sliding across the page. */}
      <div aria-hidden className="my-12 -rotate-2 overflow-hidden bg-brand py-2.5 text-brand-ink md:my-16">
        <div className="flex w-max animate-marquee font-poster text-3xl leading-none whitespace-nowrap md:text-4xl">
          <span className="pr-2">{TAPE.repeat(5)}</span>
          <span className="pr-2">{TAPE.repeat(5)}</span>
        </div>
      </div>

      <main className="pb-safe mx-auto max-w-[1500px] px-safe pb-24 md:px-10 xl:px-16">
        {!data ? (
          <PosterState
            title="The Arcade is waking up"
            action={
              <Link href={here} className={cn(PILL, 'bg-brand text-brand-ink hover:brightness-110')}>
                Try again
              </Link>
            }
          >
            The server sleeps when nobody is playing and takes about a minute to wake on the free plan.
          </PosterState>
        ) : data.games.length === 0 ? (
          <PosterState
            title="No games here yet"
            action={
              <Link href="/start" className={cn(PILL, 'bg-brand text-brand-ink hover:brightness-110')}>
                Start a crew
              </Link>
            }
          >
            Make one with your friends: pitch it in the chat, approve the plan, play it, then tap Allow to publish.
          </PosterState>
        ) : (
          <ArcadeGrid games={data.games} ranked={sort === 'top'} />
        )}
      </main>
    </div>
  );
}

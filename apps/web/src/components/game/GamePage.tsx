'use client';
/* eslint-disable @next/next/no-img-element -- game screenshots come from our API at any size */

// The public game page /g/<slug>: play the published version, the leaderboard, who made it, the
// versions, [Remix this] (sign-in, then a new or chosen crew) and the story. Drafts get a teaser.
import type { CrewSummary, GamePageResponse } from '@crewarcade/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Logo } from '@/components/brand/Logo';
import { Leaderboard } from '@/components/play/Leaderboard';
import { PlayerProvider, usePlayer } from '@/components/player/PlayerProvider';
import { StoryTimeline } from '@/components/story/StoryTimeline';
import { Button, Sheet, useToast } from '@/components/ui';
import { MemberAvatar } from '@/components/identity/MemberAvatar';
import { api, ApiRequestError } from '@/lib/api';
import { madeBy } from '@/lib/public-game';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { GameScene } from '@/components/arcade/GameScene';
import { RIM } from '@/components/landing/glass';
import { recordTourFacts } from '@/lib/tour/store';

export function GamePage({ game }: { game: GamePageResponse }) {
  const { status } = useSession();
  return (
    <PlayerProvider signedIn={status === 'ready'}>
      <GamePageBody game={game} />
    </PlayerProvider>
  );
}

/** The page accent from the game's colours: the first, unless it's too dark to read on black. Ink picks black or white. */
function accentFor([c1, c2]: [string, string]): CSSProperties {
  const lum = (hex: string) => {
    const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };
  const accent = lum(c1) < 0.3 && lum(c2) > lum(c1) ? c2 : c1;
  return { '--brand': accent, '--brand-ink': lum(accent) > 0.55 ? '#0a0a0a' : '#ffffff' } as CSSProperties;
}

function GamePageBody({ game }: { game: GamePageResponse }) {
  const { status, user } = useSession();
  const player = usePlayer();
  const params = useSearchParams();
  const [storyOpen, setStoryOpen] = useState(false);
  const [remixOpen, setRemixOpen] = useState(false);
  const published = game.publishedVersion !== null;
  const autoPlayed = useRef(false);

  const play = () => published && player.open({ gameId: game.id, version: game.publishedVersion!, title: game.title });
  useEffect(() => {
    if (published && params.get('play') && !autoPlayed.current) {
      autoPlayed.current = true;
      player.open({ gameId: game.id, version: game.publishedVersion!, title: game.title });
    }
  }, [published, params, player, game.id, game.publishedVersion, game.title]);

  return (
    // Game pages are the game's own world: always dark, and the accent is the game's own colour.
    <div data-theme="dark" className="min-h-dvh overflow-x-clip bg-bg pb-safe text-text" style={accentFor(game.colors)}>
      <header className="pt-safe relative z-20 mx-auto flex max-w-[1500px] items-center justify-between px-safe py-4 md:px-10 xl:px-16">
        <Link href="/" aria-label="CrewArcade home" className="min-h-11 content-center">
          <Logo className="text-xl" />
        </Link>
        <nav className="flex items-center gap-2 text-xs font-semibold tracking-[0.18em] uppercase" aria-label="Site">
          {/* Narrow phones: the logo already leads home and to the Arcade, so the text link waits for room. */}
          <Link href="/arcade" className="hidden min-h-11 items-center px-3 text-text/70 hover:text-text min-[400px]:inline-flex">
            Arcade
          </Link>
          {status === 'ready' ? (
            <Link
              href="/crews"
              className="inline-flex min-h-11 items-center rounded-full border border-text/25 px-4 whitespace-nowrap hover:border-brand hover:text-brand sm:px-5"
            >
              Your crews
            </Link>
          ) : (
            <Link
              href={`/start?next=${encodeURIComponent(`/g/${game.slug}`)}`}
              className="inline-flex min-h-11 items-center rounded-full border border-text/25 px-4 whitespace-nowrap hover:border-brand hover:text-brand sm:px-5"
            >
              Sign in
            </Link>
          )}
        </nav>
      </header>

      {/* Hero: the title and Play, then the game's own screen running in attract mode. */}
      <section aria-labelledby="game-title" className="mx-auto max-w-[1500px] px-safe pt-6 md:px-10 xl:px-16">
        <div className="grid items-end gap-8 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-3 rounded-2xl bg-brand px-4 py-2 text-brand-ink">
              <span className="text-2xl leading-none" aria-hidden>
                {game.emoji}
              </span>
              <span className="text-[11px] font-bold tracking-[0.2em] uppercase">
                {published ? `v${game.publishedVersion} · Live in the Arcade` : 'In the works'}
              </span>
            </span>
            {/* Long titles get a smaller size and hyphens instead of breaking words mid-letter on phones. */}
            <h1
              id="game-title"
              lang="en"
              className={`mt-6 font-poster break-words hyphens-auto uppercase ${game.title.length > 24 ? 'text-[clamp(2.25rem,6vw,6rem)] leading-[0.95]' : 'text-[clamp(3.25rem,8vw,8.5rem)] leading-[0.88]'}`}
            >
              {game.title}
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-text/80 md:text-xl">{game.pitch}</p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <div className="flex -space-x-2" aria-label={`Crew: ${game.crew.members.map(m => m.name).join(', ')}`}>
                {game.crew.members.slice(0, 6).map((m, i) => (
                  <MemberAvatar key={i} person={{ id: `${i}`, displayName: m.name, avatarEmoji: m.avatarEmoji, avatarColor: m.avatarColor }} size="sm" />
                ))}
              </div>
              <span className="text-[11px] font-semibold tracking-[0.18em] text-text/70 uppercase">{madeBy(game.crew.name)}</span>
              {game.remixOf && (
                <span className="text-sm text-text/70">
                  · Remix of{' '}
                  <Link className="font-semibold text-brand underline-offset-4 hover:underline" href={`/g/${game.remixOf.slug}`}>
                    {game.remixOf.title}
                  </Link>
                </span>
              )}
            </div>
          </div>

          {published && (
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <button
                type="button"
                onClick={play}
                data-testid="game-page-play"
                data-tour="game-play"
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-brand px-10 text-sm font-bold tracking-[0.18em] text-brand-ink uppercase shadow-[0_20px_60px_-20px_var(--brand)] transition-transform hover:scale-[1.03] active:scale-[0.98]"
              >
                ▶ Play now<span className="sr-only">: {game.title}</span>
              </button>
              {status === 'ready' ? (
                <button
                  type="button"
                  onClick={() => setRemixOpen(true)}
                  data-tour="remix"
                  className="inline-flex min-h-14 items-center justify-center rounded-full border border-text/25 px-10 text-sm font-bold tracking-[0.18em] uppercase hover:border-brand hover:text-brand"
                >
                  Remix this
                </button>
              ) : (
                <Link
                  href={`/start?next=${encodeURIComponent(`/g/${game.slug}`)}`}
                  className="inline-flex min-h-14 items-center justify-center rounded-full border border-text/25 px-10 text-sm font-bold tracking-[0.18em] uppercase hover:border-brand hover:text-brand"
                >
                  Sign in to remix
                </Link>
              )}
            </div>
          )}
        </div>

        {/* The game's screen in an arcade bezel. Click it to play. */}
        <div className="relative mt-10">
          <span aria-hidden className="absolute -inset-4 rounded-[48px] bg-brand opacity-25 blur-3xl" />
          <div className="relative rounded-[36px] bg-surface p-3 shadow-2xl md:p-4">
            <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[36px]" style={RIM} />
            {(() => {
              const screen = (
                <>
                  {game.screenshotUrl ? (
                    <img src={game.screenshotUrl} alt="" className="absolute inset-0 size-full object-cover" />
                  ) : (
                    <>
                      <GameScene seed={game.slug} emoji={game.emoji} colors={game.colors} motion="on" className="absolute inset-0 lg:hidden" />
                      <GameScene seed={game.slug} emoji={game.emoji} colors={game.colors} motion="on" wide className="absolute inset-0 hidden lg:block" />
                    </>
                  )}
                  <span className="absolute inset-0 grid place-items-center bg-black/10">
                    <span className="flex flex-col items-center gap-4">
                      {published && (
                        <span className="grid size-20 place-items-center rounded-full bg-brand text-3xl text-brand-ink shadow-2xl transition-transform group-hover:scale-110 md:size-24">
                          ▶
                        </span>
                      )}
                      <span className="animate-[blink_1.2s_steps(1)_infinite] rounded-md bg-black/55 px-3 py-1.5 font-mono text-xs font-bold tracking-[0.3em] text-white uppercase md:text-sm">
                        {published ? 'Press ▶ to play' : 'Being built…'}
                      </span>
                    </span>
                  </span>
                </>
              );
              const box = 'group relative block aspect-[4/3] w-full overflow-hidden rounded-[26px] sm:aspect-[16/9] lg:aspect-[21/9]';
              return published ? (
                <button type="button" onClick={play} aria-label={`Play ${game.title}`} className={box}>
                  {screen}
                </button>
              ) : (
                <div className={box}>{screen}</div>
              );
            })()}
            <div className="mt-3 flex items-center justify-between px-2 md:mt-4">
              <span className="truncate text-[10px] font-bold tracking-[0.25em] text-text/50 uppercase">CrewArcade ▸ {game.title}</span>
              <span className="flex shrink-0 gap-2" aria-hidden>
                <span className="size-4 rounded-full bg-brand" />
                <span className="size-4 rounded-full bg-text/50" />
                <span className="size-4 rounded-full bg-text/25" />
              </span>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1500px] px-safe py-20 md:px-10 xl:px-16">
        {!published && (
          <section className="mb-16 flex flex-col items-start gap-5 border-y border-text/12 py-14" data-testid="draft-teaser">
            <p className="font-poster text-5xl leading-[0.9] uppercase md:text-7xl">Being built by a crew</p>
            <p className="max-w-xl text-lg text-text/70">
              {game.crew.name} is making this with Pixel, Forge and Glitch. It appears here once a crew approver taps Allow.
            </p>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-brand px-4 py-1.5 text-xs font-bold tracking-[0.18em] text-brand-ink uppercase">
                {game.status === 'failed' ? 'Needs another try' : 'In progress'}
              </span>
              <span className="text-xs text-text/50">Watch live: coming soon</span>
            </div>
          </section>
        )}

        <div className="grid gap-16 lg:grid-cols-[1.2fr_1fr] lg:gap-20">
          {published && (
            <section aria-labelledby="board-title">
              <div className="mb-6 flex items-end justify-between gap-4 border-b border-text/12 pb-4">
                <h2 id="board-title" className="font-poster text-5xl leading-none uppercase md:text-6xl">
                  Leaderboard
                </h2>
                <span className="text-[11px] font-semibold tracking-[0.2em] text-brand uppercase">Beat the best</span>
              </div>
              <Leaderboard gameId={game.id} myUserId={user?.id ?? null} />
            </section>
          )}

          <div className="flex flex-col gap-14">
            {game.versions.length > 0 && (
              <section aria-labelledby="versions-title">
                <h2 id="versions-title" className="mb-5 border-b border-text/12 pb-4 font-poster text-4xl leading-none uppercase">
                  Versions
                </h2>
                <ol className="flex flex-col">
                  {game.versions.map(v => (
                    <li key={v.version} className="flex items-baseline gap-5 border-b border-text/8 py-3.5">
                      <span className={cn('w-12 font-poster text-2xl leading-none', v.published ? 'text-brand' : 'text-text/40')}>v{v.version}</span>
                      <span className="min-w-0 flex-1 text-text/75">{v.notes[0] ?? 'Built by Forge'}</span>
                      {v.published && (
                        <span className="rounded-full bg-brand px-2.5 py-0.5 text-[10px] font-bold tracking-[0.18em] text-brand-ink uppercase">Live</span>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {game.bugHunters.length > 0 && (
              <section aria-labelledby="hunters-title" data-testid="bug-hunters">
                <h2 id="hunters-title" className="mb-5 border-b border-text/12 pb-4 font-poster text-4xl leading-none uppercase">
                  Bug hunters
                </h2>
                <ul className="flex flex-col">
                  {game.bugHunters.map((b, i) => (
                    <li key={`${b.version}-${i}`} className="border-b border-text/8 py-3.5 text-text/75">
                      <strong className="text-text">{b.name}</strong> found “{b.bug}”, fixed in v{b.version}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {published && (
              <button
                type="button"
                onClick={() => {
                  setStoryOpen(true);
                  recordTourFacts('story');
                }}
                className="group flex items-center justify-between rounded-[24px] border border-text/15 bg-text/[0.04] px-6 py-5 text-left transition-colors hover:border-brand"
              >
                <span>
                  <span className="block font-poster text-3xl leading-none uppercase">How it was made</span>
                  <span className="mt-1.5 block text-sm text-text/60">Every agent step and decision, with time and cost.</span>
                </span>
                <span aria-hidden className="text-2xl text-brand transition-transform group-hover:translate-x-1">
                  →
                </span>
              </button>
            )}

            {game.remixes.length > 0 && (
              <section>
                <h2 className="mb-5 border-b border-text/12 pb-4 font-poster text-4xl leading-none uppercase">Remixed as</h2>
                <ul className="flex flex-wrap gap-2">
                  {game.remixes.map(r => (
                    <li key={r.slug}>
                      <Link
                        href={`/g/${r.slug}`}
                        className="inline-flex min-h-11 items-center rounded-full border border-text/20 px-5 text-sm font-semibold hover:border-brand"
                      >
                        {r.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </main>

      {/* Closing panel in the game's colour: make your own. */}
      <section className="mx-3 mb-6 rounded-[32px] bg-brand text-brand-ink md:mx-6">
        <div className="flex flex-col items-start gap-6 px-8 py-20 md:flex-row md:items-end md:justify-between md:px-14">
          <h2 className="font-poster text-6xl leading-[0.9] uppercase md:text-8xl">
            Make your own
            <br />
            with friends
          </h2>
          <div className="flex max-w-sm flex-col items-start gap-4">
            <p className="opacity-80">Pitch an idea in a group chat. Three AI agents plan, build and test it in minutes.</p>
            <Link
              href="/start"
              className="inline-flex min-h-12 items-center rounded-full bg-brand-ink px-8 text-sm font-bold tracking-[0.18em] text-brand uppercase hover:opacity-90"
            >
              Start a crew
            </Link>
          </div>
        </div>
      </section>

      {published && (
        <Sheet open={storyOpen} onClose={() => setStoryOpen(false)} title={`How ${game.title} was made`}>
          <StoryTimeline gameId={game.id} refreshKey={0} />
        </Sheet>
      )}
      {published && status === 'ready' && <RemixSheet open={remixOpen} onClose={() => setRemixOpen(false)} game={game} />}
    </div>
  );
}

function RemixSheet({ open, onClose, game }: { open: boolean; onClose: () => void; game: GamePageResponse }) {
  const router = useRouter();
  const toast = useToast();
  const [crews, setCrews] = useState<CrewSummary[] | null>(null);
  const [target, setTarget] = useState<string>('new');
  const [name, setName] = useState(`${game.title} remix`.slice(0, 40));
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && !crews) void api.crews().then(setCrews, () => setCrews([]));
  }, [open, crews]);

  const go = async () => {
    setBusy(true);
    try {
      const r = await api.remix(game.slug, {
        ...(target === 'new' ? { newCrewName: name.trim() || `${game.title} remix` } : { crewId: target }),
        ...(idea.trim() && { idea: idea.trim() }),
      });
      recordTourFacts('remix');
      toast('Pixel is planning your remix in the crew chat.', 'success');
      router.push(`/crews/${r.crewId}`);
    } catch (e) {
      toast(e instanceof ApiRequestError ? e.message : "Couldn't start the remix.", 'danger');
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Remix ${game.title}`}
      footer={
        <Button block loading={busy} onClick={() => void go()} disabled={target === 'new' && !name.trim()}>
          Start the remix
        </Button>
      }
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-dim">Which crew makes it? Pixel plans the remix there; v1 starts from this game&apos;s code.</legend>
        <label className="flex min-h-11 items-center gap-3 rounded-2xl bg-surface-2 px-3">
          <input type="radio" name="remix-crew" checked={target === 'new'} onChange={() => setTarget('new')} />
          <span className="text-sm font-semibold">A new crew</span>
        </label>
        {target === 'new' && (
          <input
            aria-label="New crew name"
            value={name}
            onChange={e => setName(e.target.value.slice(0, 40))}
            className="rounded-2xl border border-border bg-surface-2 p-3 text-base outline-none focus:border-brand"
          />
        )}
        {(crews ?? []).map(c => (
          <label key={c.id} className="flex min-h-11 items-center gap-3 rounded-2xl bg-surface-2 px-3">
            <input type="radio" name="remix-crew" checked={target === c.id} onChange={() => setTarget(c.id)} />
            <span className="truncate text-sm font-semibold">{c.name}</span>
          </label>
        ))}
      </fieldset>
      <label htmlFor="remix-idea" className="mt-4 block text-sm text-dim">
        What&apos;s your twist? (optional)
      </label>
      <textarea
        id="remix-idea"
        value={idea}
        onChange={e => setIdea(e.target.value.slice(0, 280))}
        rows={2}
        placeholder="With mangoes instead of potholes…"
        className="mt-2 w-full rounded-2xl border border-border bg-surface-2 p-3 text-base outline-none focus:border-brand"
      />
    </Sheet>
  );
}

'use client';

// The public game page /g/<slug>: play the published version, the leaderboard, who made it, the
// versions, [Remix this] (sign-in, then a new or chosen crew) and the story. Drafts get a teaser.
import type { CrewSummary, GamePageResponse } from '@crewarcade/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Leaderboard } from '@/components/play/Leaderboard';
import { PlayerProvider, usePlayer } from '@/components/player/PlayerProvider';
import { StoryTimeline } from '@/components/story/StoryTimeline';
import { Badge, Button, Sheet, useToast } from '@/components/ui';
import { MemberAvatar } from '@/components/identity/MemberAvatar';
import { api, ApiRequestError } from '@/lib/api';
import { madeBy } from '@/lib/public-game';
import { useSession } from '@/lib/session';

export function GamePage({ game }: { game: GamePageResponse }) {
  const { status } = useSession();
  return (
    <PlayerProvider signedIn={status === 'ready'}>
      <GamePageBody game={game} />
    </PlayerProvider>
  );
}

function GamePageBody({ game }: { game: GamePageResponse }) {
  const { status, user } = useSession();
  const player = usePlayer();
  const params = useSearchParams();
  const [storyOpen, setStoryOpen] = useState(false);
  const [remixOpen, setRemixOpen] = useState(false);
  const published = game.publishedVersion !== null;
  const [c1, c2] = game.colors;
  const autoPlayed = useRef(false);

  const play = () => published && player.open({ gameId: game.id, version: game.publishedVersion!, title: game.title });
  useEffect(() => {
    if (published && params.get('play') && !autoPlayed.current) {
      autoPlayed.current = true;
      player.open({ gameId: game.id, version: game.publishedVersion!, title: game.title });
    }
  }, [published, params, player, game.id, game.publishedVersion, game.title]);

  return (
    <div className="min-h-dvh bg-bg pb-safe">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <Link href="/" className="min-h-11 content-center font-display font-bold">
          CrewArcade
        </Link>
        {status === 'ready' ? (
          <Link href="/crews" className="min-h-11 content-center text-sm font-semibold text-brand">
            Your crews
          </Link>
        ) : (
          <Link href={`/start?next=${encodeURIComponent(`/g/${game.slug}`)}`} className="min-h-11 content-center text-sm font-semibold text-brand">
            Sign in
          </Link>
        )}
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4">
        <section
          className="flex flex-col gap-4 rounded-card border border-border p-5 sm:flex-row sm:items-center"
          style={{ background: `linear-gradient(135deg, transparent 30%, ${c1}33 100%)` }}
        >
          <div
            className="flex size-28 shrink-0 items-center justify-center rounded-[2rem] bg-surface-2 text-6xl"
            style={{ border: `4px solid ${c2}` }}
            aria-hidden
          >
            {game.emoji}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-bold break-words">{game.title}</h1>
            <p className="mt-1 text-dim">{game.pitch}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="flex -space-x-2" aria-label={`Crew: ${game.crew.members.map(m => m.name).join(', ')}`}>
                {game.crew.members.slice(0, 6).map((m, i) => (
                  <MemberAvatar key={i} person={{ id: `${i}`, displayName: m.name, avatarEmoji: m.avatarEmoji, avatarColor: m.avatarColor }} size="sm" />
                ))}
              </div>
              <span className="text-sm text-dim">{madeBy(game.crew.name)}</span>
            </div>
            {game.remixOf && (
              <p className="mt-2 text-sm text-dim">
                Remix of{' '}
                <Link className="font-semibold text-brand" href={`/g/${game.remixOf.slug}`}>
                  {game.remixOf.title}
                </Link>
              </p>
            )}
          </div>
        </section>

        {published ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="lg" block onClick={play} data-testid="game-page-play">
              ▶ Play {game.title}
            </Button>
            {status === 'ready' ? (
              <Button size="lg" variant="secondary" block onClick={() => setRemixOpen(true)}>
                🔀 Remix this
              </Button>
            ) : (
              <Link
                href={`/start?next=${encodeURIComponent(`/g/${game.slug}`)}`}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-border bg-surface-2 px-5 font-semibold"
              >
                🔀 Sign in to remix
              </Link>
            )}
          </div>
        ) : (
          <section className="rounded-card border border-dashed border-border bg-surface p-5 text-center" data-testid="draft-teaser">
            <p className="text-3xl" aria-hidden>
              🚧
            </p>
            <h2 className="mt-1 font-display text-xl font-bold">Being built by a crew</h2>
            <p className="mt-1 text-sm text-dim">
              {game.crew.name} is making this with Pixel, Forge and Glitch. It appears here once a crew approver taps Allow.
            </p>
            <div className="mt-4 flex flex-col items-center gap-2">
              <Badge tone="forge">{game.status === 'failed' ? 'Needs another try' : 'In progress'}</Badge>
              <span className="text-xs text-faint">Watch live: coming soon</span>
            </div>
          </section>
        )}

        {published && (
          <section aria-labelledby="board-title" className="flex flex-col gap-3">
            <h2 id="board-title" className="font-display text-xl font-bold">
              🏆 Leaderboard
            </h2>
            <Leaderboard gameId={game.id} myUserId={user?.id ?? null} />
          </section>
        )}

        {game.versions.length > 0 && (
          <section aria-labelledby="versions-title" className="flex flex-col gap-2">
            <h2 id="versions-title" className="font-display text-xl font-bold">
              Versions
            </h2>
            <ol className="flex flex-col gap-1">
              {game.versions.map(v => (
                <li key={v.version} className="flex items-start gap-3 rounded-2xl bg-surface px-3 py-2 text-sm">
                  <span className="font-display font-bold">v{v.version}</span>
                  <span className="min-w-0 flex-1 text-dim">{v.notes[0] ?? 'Built by Forge'}</span>
                  {v.published && <Badge tone="success">Live</Badge>}
                </li>
              ))}
            </ol>
          </section>
        )}

        {published && (
          <Button variant="ghost" onClick={() => setStoryOpen(true)}>
            📜 How it was made
          </Button>
        )}

        {game.remixes.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="font-display text-xl font-bold">Remixed as</h2>
            <ul className="flex flex-wrap gap-2">
              {game.remixes.map(r => (
                <li key={r.slug}>
                  <Link href={`/g/${r.slug}`} className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold">
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="my-6 rounded-card bg-surface-2 p-5 text-center">
          <h2 className="font-display text-lg font-bold">Make your own with friends</h2>
          <p className="mt-1 text-sm text-dim">Pitch an idea in a group chat. Three AI agents plan, build and test it in minutes.</p>
          <Link href="/start" className="mt-3 inline-flex min-h-11 items-center rounded-2xl bg-brand px-5 font-semibold text-brand-ink">
            Start a crew
          </Link>
        </section>
      </main>

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

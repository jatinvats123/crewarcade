'use client';

// The game player: a full-screen overlay with the game in a sandboxed iframe (scripts and pointer
// lock only, NEVER allow-same-origin), served by our server with a strict CSP. It listens for the
// engine's score hook, accepting only our iframe's messages in the expected shapes, and reports
// finished runs to /api/scores. Works with touch (the engine draws on-screen buttons) and keyboard
// (the iframe gets focus when it loads). Anywhere in the app: usePlayer().open({ gameId, version }).
import type { PlayUrlResponse, ScoreResponse } from '@crewarcade/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton, useToast } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import { acceptHostMessage, GAME_ALLOW, GAME_SANDBOX } from '@/lib/player-messages';

export interface PlayRequest {
  gameId: string;
  version: number | 'latest';
  title?: string;
}

interface PlayerValue {
  open: (r: PlayRequest) => void;
  /** Bumps whenever a score was saved for a game (leaderboards refetch). */
  scoreTick: (gameId: string) => number;
  subscribe: (fn: () => void) => () => void;
}

const PlayerContext = createContext<PlayerValue | null>(null);

export function usePlayer(): PlayerValue {
  const v = useContext(PlayerContext);
  if (!v) throw new Error('usePlayer needs <PlayerProvider>');
  return v;
}

/** Re-renders when a score is saved for this game; returns a counter to use as a fetch key. */
export function useScoreTick(gameId: string | null): number {
  const v = useContext(PlayerContext);
  const [, force] = useState(0);
  useEffect(() => (v ? v.subscribe(() => force(n => n + 1)) : undefined), [v]);
  return v && gameId ? v.scoreTick(gameId) : 0;
}

export function PlayerProvider({ children, signedIn = true }: { children: ReactNode; signedIn?: boolean }) {
  const [request, setRequest] = useState<PlayRequest | null>(null);
  const ticks = useRef(new Map<string, number>());
  const listeners = useRef(new Set<() => void>());
  const bump = useCallback((gameId: string) => {
    ticks.current.set(gameId, (ticks.current.get(gameId) ?? 0) + 1);
    for (const l of listeners.current) l();
  }, []);
  const value = useMemo<PlayerValue>(
    () => ({
      open: setRequest,
      scoreTick: id => ticks.current.get(id) ?? 0,
      subscribe: fn => {
        listeners.current.add(fn);
        return () => void listeners.current.delete(fn);
      },
    }),
    [],
  );
  return (
    <PlayerContext.Provider value={value}>
      {children}
      {request && (
        <GamePlayer key={`${request.gameId}:${request.version}`} request={request} signedIn={signedIn} onClose={() => setRequest(null)} onScore={bump} />
      )}
    </PlayerContext.Provider>
  );
}

type Phase = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; link: PlayUrlResponse; frameLoaded: boolean };

function useIsPortraitPhone(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
    const on = () => setV(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return v;
}

export function GamePlayer({
  request,
  onClose,
  onScore,
  signedIn,
}: {
  request: PlayRequest;
  onClose: () => void;
  onScore: (gameId: string) => void;
  signedIn: boolean;
}) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [rotateDismissed, setRotateDismissed] = useState(false);
  const [last, setLast] = useState<ScoreResponse | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const portraitPhone = useIsPortraitPhone();

  // Fetch a (signed, short-lived) play URL for this version.
  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: 'loading' });
    api
      .playUrl(request.gameId, request.version)
      .then(link => !cancelled && setPhase({ kind: 'ready', link, frameLoaded: false }))
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg =
          e instanceof ApiRequestError && e.status === 404 ? 'This version is not available to you.' : "Couldn't load the game. Check your connection.";
        setPhase({ kind: 'error', message: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [request.gameId, request.version, attempt]);

  // Lock page scroll while playing; Escape (when focus is outside the game) closes.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // The score hook: only our iframe, only the two expected shapes.
  const link = phase.kind === 'ready' ? phase.link : null;
  useEffect(() => {
    if (!link) return;
    const gameOrigin = new URL(link.url).origin;
    const onMessage = (e: MessageEvent) => {
      const msg = acceptHostMessage({ source: e.source, origin: e.origin, data: e.data }, frame.current?.contentWindow ?? null, gameOrigin);
      if (!msg || msg.type !== 'crewarcade:score') return;
      if (!signedIn) {
        toast(`Score ${msg.score}. Sign in to save it on the leaderboard.`, 'info');
        return;
      }
      void api
        .submitScore({ gameId: link.gameId, version: link.version, score: msg.score, timeMs: Math.round(msg.time * 1000) })
        .then(r => {
          setLast(r);
          if (r.accepted) {
            onScore(link.gameId);
            if (r.newBest) toast(r.rank === 1 ? `🏆 New best: ${msg.score}. You're #1!` : `New best: ${msg.score} (#${r.rank})`, 'success');
          } else if (r.reason) toast(r.reason, 'info');
        })
        .catch(() => toast("Couldn't save that score.", 'danger'));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [link, signedIn, onScore, toast]);

  const title = link?.title ?? request.title ?? 'Game';
  const showRotate = !!link && link.orientation === 'landscape' && portraitPhone && !rotateDismissed;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Playing ${title}`}
      className="fixed inset-0 z-[60] flex flex-col bg-[#07050f] text-white"
      data-testid="game-player"
    >
      <div className="flex items-center gap-2 px-2 pt-[max(env(safe-area-inset-top),0.25rem)] pb-1">
        <IconButton ref={closeRef} label="Close the game" icon={<span aria-hidden>✕</span>} onClick={onClose} className="text-white hover:bg-white/10" />
        <p className="min-w-0 flex-1 truncate font-display font-bold">
          {title}
          {link && <span className="ml-2 text-sm font-normal text-white/60">v{link.version}</span>}
        </p>
        {last?.accepted && last.best !== null && (
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold" aria-live="polite">
            Best {last.best}
            {last.rank ? ` · #${last.rank}` : ''}
          </span>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {phase.kind === 'ready' && (
          <iframe
            ref={frame}
            title={`${title} (game)`}
            src={phase.link.url}
            sandbox={GAME_SANDBOX}
            allow={GAME_ALLOW}
            referrerPolicy="no-referrer"
            className="absolute inset-0 size-full border-0 bg-[#07050f]"
            onLoad={() => {
              setPhase(p => (p.kind === 'ready' ? { ...p, frameLoaded: true } : p));
              // Keyboard: arrow keys and Space go to the game right away.
              frame.current?.focus();
            }}
          />
        )}
        {(phase.kind === 'loading' || (phase.kind === 'ready' && !phase.frameLoaded)) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4" aria-busy aria-label="Loading the game">
            <div className="size-16 animate-pulse rounded-3xl bg-white/10" />
            <div className="h-3 w-40 animate-pulse rounded-full bg-white/10" />
            <p className="text-sm text-white/60">Loading {title}…</p>
          </div>
        )}
        {phase.kind === 'error' && (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <span className="text-4xl" aria-hidden>
              👾
            </span>
            <p className="max-w-xs text-white/80">{phase.message}</p>
            <div className="flex gap-2">
              <Button onClick={() => setAttempt(a => a + 1)}>Try again</Button>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
        {showRotate && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/85 p-6 text-center" role="status">
            <span className="animate-[spin_2s_ease-in-out_infinite] text-5xl" aria-hidden>
              📱
            </span>
            <p className="font-display text-lg font-bold">Turn your phone sideways</p>
            <p className="max-w-xs text-sm text-white/70">This game plays best in landscape.</p>
            <Button variant="secondary" onClick={() => setRotateDismissed(true)}>
              Play anyway
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

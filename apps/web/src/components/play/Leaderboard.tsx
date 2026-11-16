'use client';

// Top 20 for a game, my best and my rank. Refetches whenever the player saves a score.
import type { LeaderboardResponse } from '@crewarcade/shared';
import { useEffect, useState } from 'react';
import { useScoreTick } from '@/components/player/PlayerProvider';
import { MemberAvatar } from '@/components/identity/MemberAvatar';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

const MEDAL = ['🥇', '🥈', '🥉'];

export function Leaderboard({
  gameId,
  myUserId,
  refreshKey = 0,
  compact = false,
}: {
  gameId: string;
  myUserId?: string | null;
  refreshKey?: number;
  compact?: boolean;
}) {
  const tick = useScoreTick(gameId);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .leaderboard(gameId)
      .then(d => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [gameId, tick, refreshKey, attempt]);

  if (error && !data)
    return (
      <ErrorState title="Leaderboard unavailable" onRetry={() => setAttempt(a => a + 1)}>
        {error}
      </ErrorState>
    );
  if (!data)
    return (
      <div className="space-y-2" aria-busy aria-label="Loading the leaderboard">
        {[0, 1, 2].map(i => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  if (data.top.length === 0)
    return (
      <EmptyState emoji="🏁" title="No scores yet">
        Play a round: the first score takes #1.
      </EmptyState>
    );
  const rows = compact ? data.top.slice(0, 5) : data.top;
  return (
    <div className="flex flex-col gap-3" data-testid="leaderboard">
      <ol className="flex flex-col gap-1">
        {rows.map(e => (
          <li key={e.userId} className={cn('flex min-h-11 items-center gap-3 rounded-2xl px-3 py-1.5', e.userId === myUserId ? 'bg-brand/15' : 'bg-surface')}>
            <span className="w-7 text-center font-display font-bold tabular-nums">{MEDAL[e.rank - 1] ?? e.rank}</span>
            <MemberAvatar person={{ id: e.userId, displayName: e.name, avatarEmoji: e.avatarEmoji, avatarColor: e.avatarColor }} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{e.name}</span>
            <span className="font-display font-bold tabular-nums">{e.score.toLocaleString()}</span>
          </li>
        ))}
      </ol>
      {data.me && (
        <p className="text-sm text-dim" aria-live="polite">
          Your best: <strong className="text-text">{data.me.best.toLocaleString()}</strong> · rank #{data.me.rank}
        </p>
      )}
    </div>
  );
}

'use client';

// "Story": the game's Decision Ledger as a vertical timeline. Who did what, when, with tokens and
// cost for agent steps; input/output expandable (already redacted by the server); Export JSON.
import { AGENTS, type LedgerEntry, type LedgerResponse } from '@crewarcade/shared';
import { useCallback, useEffect, useState } from 'react';
import { agentKeyOf } from '@/components/identity/MemberAvatar';
import { Avatar, Button, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

const LABELS: Record<string, string> = {
  'plan.created': 'Planned the game',
  'plan.revised': 'Revised the plan',
  'plan.vote': 'Voted',
  'plan.change_requested': 'Asked for a change',
  'plan.approved': 'Approved the plan',
  'plan.refused': 'Declined a request',
  'plan.failed': 'Hit a problem',
  'room.created': 'Opened the game room',
  handoff: 'Handed off',
  'build.queued': 'Queued a build',
  'agent.replied': 'Replied',
  'agent.explained': 'Explained',
  'crew.memory_updated': 'Remembered a preference',
};
export const actionLabel = (a: string): string => LABELS[a] ?? a.replace(/[._]/g, ' ');

export function ledgerFileName(slug: string | undefined): string {
  return `crewarcade-${slug ?? 'game'}-story.json`;
}

export function StoryTimeline({ gameId, refreshKey = 0 }: { gameId: string; refreshKey?: number }) {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.ledger(gameId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [gameId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const exportJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ledgerFileName(data.game?.slug);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (error) return <ErrorState onRetry={() => void load()}>{error}</ErrorState>;
  if (!data)
    return (
      <div className="space-y-3" aria-busy>
        {[0, 1, 2].map(i => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-faint">
        <span>
          {data.entries.length} steps · {(data.totals.tokensIn + data.totals.tokensOut).toLocaleString()} tokens · ${data.totals.costUsd.toFixed(4)} · agents{' '}
          {Math.round(data.totals.agentMs / 1000)} s
        </span>
        <Button size="sm" variant="secondary" onClick={exportJson}>
          ⬇ Export JSON
        </Button>
      </div>
      <ol className="relative flex flex-col gap-3 border-l-2 border-border pl-4" aria-label="How this game was made">
        {data.entries.map(e => (
          <StoryItem key={e.id} e={e} />
        ))}
      </ol>
    </div>
  );
}

function StoryItem({ e }: { e: LedgerEntry }) {
  const [open, setOpen] = useState(false);
  const agent = e.actorType === 'agent' ? agentKeyOf(e.actorId) : null;
  const hasDetail = e.input !== null || e.output !== null || !!e.reason;
  return (
    <li className="relative">
      <span className="absolute top-1 -left-[1.6rem]">
        {agent ? (
          <Avatar kind="agent" agent={agent} size="sm" />
        ) : (
          <span
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-full ring-2',
              e.actorType === 'human' ? 'bg-brand/15 ring-brand/50' : 'bg-surface-2 ring-border',
            )}
            aria-hidden
          >
            {e.actorType === 'human' ? '🧑' : '⚙️'}
          </span>
        )}
      </span>
      <div className="ml-3 rounded-2xl border border-border bg-surface px-3 py-2">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold">{agent ? AGENTS[agent].displayName.split(' ')[0] : e.actorName}</span>
          <span className="text-dim">{actionLabel(e.action)}</span>
          <time className="ml-auto text-xs text-faint" dateTime={e.createdAt}>
            {new Date(e.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </time>
        </p>
        <p className="text-sm">{e.summary}</p>
        {e.actorType === 'agent' && (e.tokensIn > 0 || e.ms) ? (
          <p className="text-xs text-faint">
            {e.tokensIn.toLocaleString()} in · {e.tokensOut.toLocaleString()} out · ${e.costUsd.toFixed(4)}
            {e.ms ? ` · ${(e.ms / 1000).toFixed(1)} s` : ''}
          </p>
        ) : null}
        {hasDetail && (
          <>
            <button type="button" className="min-h-9 text-xs font-semibold text-pixel" aria-expanded={open} onClick={() => setOpen(v => !v)}>
              {open ? 'Hide details' : 'Details'}
            </button>
            {open && (
              <pre className="mt-1 max-h-64 overflow-auto rounded-xl bg-surface-2 p-2 text-[0.7rem] leading-snug whitespace-pre-wrap">
                {JSON.stringify({ ...(e.reason && { reason: e.reason }), input: e.input, output: e.output }, null, 2)}
              </pre>
            )}
          </>
        )}
      </div>
    </li>
  );
}

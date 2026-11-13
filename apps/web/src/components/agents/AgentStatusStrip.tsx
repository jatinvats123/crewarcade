'use client';

// Agent Status Strip (top of every room): Pixel, Forge, Glitch with live chips driven by
// CA:AgentState status messages (+ the server's 5 s heartbeat). Tap an agent: a sheet with what it
// is doing and its last 5 Decision Ledger actions in this crew.
import { AGENTS, type AgentKey, type AgentStateMessage, type LedgerEntry } from '@crewarcade/shared';
import { useEffect, useState } from 'react';
import { Avatar, Sheet, StateChip } from '@/components/ui';
import { ACCENT_TEXT, BUSY_STATES, STATE_LABEL } from '@/lib/agents';
import { api } from '@/lib/api';
import { elapsed } from '@/lib/cards';
import { roomAgentStates } from '@/lib/chat/reducer';
import type { ChannelState } from '@/lib/chat/types';
import { actionLabel } from '@/components/story/StoryTimeline';

const KEYS: AgentKey[] = ['pixel', 'forge', 'glitch'];

/** "thinking…", "building 32s", "testing 12/18", "waiting for approval". */
export function chipDetail(s: AgentStateMessage, now: number): string | undefined {
  if (s.progress) return `${s.progress.done}/${s.progress.total}`;
  if (BUSY_STATES.has(s.state)) return elapsed(now - s.startedAt);
  return s.detail || undefined;
}

export function AgentStatusStrip({ channel, crewId }: { channel: ChannelState | undefined; crewId: string }) {
  const states = roomAgentStates(channel);
  const byAgent = new Map(states.map(s => [s.agentId, s]));
  const busy = states.some(s => BUSY_STATES.has(s.state));
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState<AgentKey | null>(null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);

  return (
    <>
      <div
        role="status"
        aria-label="What the agents are doing"
        className="flex gap-1.5 overflow-x-auto border-b border-border px-2 py-1.5 [scrollbar-width:none] sm:px-3"
      >
        {KEYS.map(k => {
          const s = byAgent.get(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => setOpen(k)}
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface py-1 pr-1 pl-1 hover:bg-surface-2"
              aria-label={`${AGENTS[k].displayName}: ${s ? STATE_LABEL[s.state] : 'Idle'}${s?.detail ? `, ${s.detail}` : ''}`}
            >
              <Avatar kind="agent" agent={k} size="sm" {...(s && { state: s.state })} />
              <span className={`text-xs font-semibold ${ACCENT_TEXT[k]}`}>{AGENTS[k].displayName.split(' ')[0]}</span>
              <StateChip state={s?.state ?? 'idle'} {...(s && chipDetail(s, now) ? { detail: chipDetail(s, now)! } : {})} />
            </button>
          );
        })}
      </div>
      <AgentSheet agent={open} crewId={crewId} state={open ? byAgent.get(open) : undefined} now={now} onClose={() => setOpen(null)} />
    </>
  );
}

function AgentSheet({
  agent,
  crewId,
  state,
  now,
  onClose,
}: {
  agent: AgentKey | null;
  crewId: string;
  state: AgentStateMessage | undefined;
  now: number;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!agent) return;
    let live = true;
    setEntries(null);
    setError(null);
    api
      .agentActivity(crewId, agent)
      .then(e => live && setEntries(e))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [agent, crewId]);
  if (!agent) return null;
  const a = AGENTS[agent];
  return (
    <Sheet open onClose={onClose} title={a.displayName}>
      <div className="flex items-center gap-3">
        <Avatar kind="agent" agent={agent} size="lg" {...(state && { state: state.state })} />
        <div className="min-w-0">
          <p className="text-sm text-dim">{a.tagline}</p>
          <p className="mt-1">
            <StateChip state={state?.state ?? 'idle'} {...(state && chipDetail(state, now) ? { detail: chipDetail(state, now)! } : {})} />
          </p>
          {state?.detail && <p className="mt-1 text-sm">{state.detail}</p>}
        </div>
      </div>
      <h3 className="mt-4 text-xs font-semibold tracking-wide text-faint uppercase">Last 5 actions in this crew</h3>
      {error ? (
        <p className="mt-2 text-sm text-danger">{error}</p>
      ) : !entries ? (
        <p className="mt-2 text-sm text-faint">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-2 text-sm text-faint">Nothing yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {entries.map(e => (
            <li key={e.id} className="rounded-2xl border border-border bg-surface-2 px-3 py-2 text-sm">
              <p className="font-semibold">{actionLabel(e.action)}</p>
              <p className="text-dim">{e.summary}</p>
              <p className="text-xs text-faint">
                {new Date(e.createdAt).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}
                {e.tokensIn + e.tokensOut > 0 && ` · ${(e.tokensIn + e.tokensOut).toLocaleString()} tokens · $${e.costUsd.toFixed(4)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

'use client';

// Desktop right column: the room's agents with live states and, in a game room, the game and its
// Story (the Decision Ledger timeline). Phones and tablets open the Story as a sheet from the header.
import { AGENTS, type AgentKey } from '@crewarcade/shared';
import { useEffect, useState } from 'react';
import { chipDetail } from '@/components/agents/AgentStatusStrip';
import { StoryTimeline } from '@/components/story/StoryTimeline';
import { Avatar, Badge, StateChip } from '@/components/ui';
import { ACCENT_TEXT } from '@/lib/agents';
import { roomAgentStates } from '@/lib/chat/reducer';
import { useChannelState } from '@/lib/chat/store';
import { useNexconn } from '@/lib/nexconn/NexconnProvider';
import { useActiveRoom } from '@/lib/room';

const STATUS: Record<string, string> = {
  planning: 'Planning',
  building: 'Building',
  testing: 'Testing',
  awaiting_approval: 'Waiting for Allow',
  published: 'Published',
  failed: 'Needs help',
};

export function ContextPanel() {
  const room = useActiveRoom();
  const { store } = useNexconn();
  const channel = useChannelState(store, room?.channelId ?? null);
  const states = new Map(roomAgentStates(channel).map(s => [s.agentId, s]));
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<'story' | 'agents'>('story');
  const cards = channel?.messages.filter(m => m.kind === 'card').length ?? 0;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const agents = (
    <ul className="flex flex-col gap-3">
      {(Object.keys(AGENTS) as AgentKey[]).map(k => {
        const s = states.get(k);
        const detail = s ? chipDetail(s, now) : undefined;
        return (
          <li key={k} className="flex items-center gap-3 rounded-card border border-border bg-surface p-3">
            <Avatar kind="agent" agent={k} size="md" presence="online" {...(s && { state: s.state })} />
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${ACCENT_TEXT[k]}`}>{AGENTS[k].displayName}</p>
              <StateChip state={s?.state ?? 'idle'} className="mt-1" {...(detail && { detail })} />
              {s?.detail && <p className="mt-1 truncate text-xs text-dim">{s.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );

  if (!room?.game)
    return (
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
        <h2 className="font-display text-lg font-bold">Game panel</h2>
        <p className="text-sm text-dim">Approved plans get their own game room. Open one to see its Story: every decision, who made it, and what it cost.</p>
        {agents}
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border p-5 pb-3">
        <p className="text-xs font-semibold tracking-wide text-faint uppercase">Game</p>
        <h2 className="font-display text-lg font-bold">🎮 {room.game.title}</h2>
        <Badge tone="forge" className="mt-1">
          {STATUS[room.game.status] ?? room.game.status}
        </Badge>
        <div role="tablist" aria-label="Game panel" className="mt-3 flex gap-1">
          {(['story', 'agents'] as const).map(t => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold ${tab === t ? 'bg-brand/15 text-brand' : 'text-dim hover:text-text'}`}
            >
              {t === 'story' ? '📜 Story' : '🤖 Agents'}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5" role="tabpanel">
        {tab === 'story' ? <StoryTimeline gameId={room.game.id} refreshKey={cards} /> : agents}
      </div>
    </div>
  );
}

'use client';

// Desktop right column, "Crew HQ": the room's three agents with live states (the one working is lit
// in its colour) and, in a game room, the game being made, its Story (the Decision Ledger timeline)
// and leaderboard. Phones and tablets open the Story as a sheet from the header.
import { AGENTS, type AgentKey } from '@crewarcade/shared';
import { useEffect, useState } from 'react';
import { chipDetail } from '@/components/agents/AgentStatusStrip';
import { GameScene } from '@/components/arcade/GameScene';
import { MemberAvatar } from '@/components/identity/MemberAvatar';
import { Leaderboard } from '@/components/play/Leaderboard';
import { StoryTimeline } from '@/components/story/StoryTimeline';
import { Avatar, StateChip, useToast } from '@/components/ui';
import { ACCENT_TEXT, BUSY_STATES } from '@/lib/agents';
import { roomAgentStates } from '@/lib/chat/reducer';
import { useChannelState, usePresence } from '@/lib/chat/store';
import { cn } from '@/lib/cn';
import { useCrews } from '@/lib/crews';
import { useNexconn } from '@/lib/nexconn/NexconnProvider';
import { paletteFor } from '@/lib/palette';
import { useActiveRoom } from '@/lib/room';
import { useSession } from '@/lib/session';
import { inviteUrl, shareInvite } from '@/lib/share';
import { recordTourFacts } from '@/lib/tour/store';

const STATUS: Record<string, string> = {
  planning: 'Planning',
  building: 'Building',
  testing: 'Testing',
  built: 'Ready to play',
  awaiting_approval: 'Waiting for Allow',
  published: 'Published',
  failed: 'Needs help',
  blocked: 'Blocked',
};

// Lit row for the agent that's working, in its own colour.
const LIT: Record<AgentKey, string> = {
  pixel: 'border-pixel/60 bg-pixel/10 shadow-[0_16px_40px_-22px_var(--pixel)]',
  forge: 'border-forge/60 bg-forge/10 shadow-[0_16px_40px_-22px_var(--forge)]',
  glitch: 'border-glitch/60 bg-glitch/10 shadow-[0_16px_40px_-22px_var(--glitch)]',
};

const TABS = { story: 'Story', board: 'Scores', agents: 'Agents' } as const;

/** The humans in the crew with online dots, empty seats while it's small, and the invite code. */
function YourCrew({ crewId }: { crewId: string }) {
  const { details } = useCrews();
  const nx = useNexconn();
  const presence = usePresence(nx.presence);
  const { user } = useSession();
  const toast = useToast();
  const crew = details[crewId];
  if (!crew) return null;
  const humans = crew.members.filter(m => !m.isAgent);
  const seats = Math.max(0, 4 - humans.length);
  const invite = async () => {
    const r = await shareInvite(crew.name, inviteUrl(window.location.origin, crew.inviteCode));
    if (r === 'copied') toast('Invite link copied', 'success');
    if (r === 'failed') toast("Couldn't share the link", 'danger');
  };
  return (
    <section aria-labelledby="your-crew" className="flex flex-col gap-3">
      <h3 id="your-crew" className="text-[11px] font-semibold tracking-[0.2em] text-faint uppercase">
        Your crew · {humans.length} {humans.length === 1 ? 'friend' : 'friends'}
      </h3>
      <ul className="flex flex-col gap-1">
        {humans.slice(0, 6).map(m => {
          const online = m.id === user?.id || presence[m.nexconnId];
          return (
            <li key={m.id} className="flex min-h-12 items-center gap-3 px-1">
              <MemberAvatar person={m} size="sm" presence={online ? 'online' : 'offline'} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {m.displayName}
                  {m.id === user?.id && <span className="font-normal text-faint"> (you)</span>}
                </span>
                <span className="block text-xs text-dim capitalize">
                  {m.role} · {online ? 'online' : 'offline'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {humans.length > 6 && <p className="px-1 text-xs text-dim">and {humans.length - 6} more</p>}
      {seats > 0 && (
        <div className="flex gap-2 px-1" aria-hidden>
          {Array.from({ length: seats }, (_, i) => (
            <span key={i} className="size-9 rounded-full border-2 border-dashed border-text/20" />
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 rounded-[18px] border border-brand/35 bg-brand/5 px-4 py-3">
        <span>
          <span className="block text-xs text-dim">Invite code</span>
          <span className="block font-mono text-base font-bold tracking-[0.15em]">{crew.inviteCode}</span>
        </span>
        <button
          type="button"
          onClick={() => void invite()}
          data-tour="invite"
          className="min-h-10 rounded-full bg-brand px-4 text-sm font-bold text-brand-ink hover:brightness-110"
        >
          Invite
        </button>
      </div>
    </section>
  );
}

export function ContextPanel() {
  const room = useActiveRoom();
  const { store } = useNexconn();
  const channel = useChannelState(store, room?.channelId ?? null);
  const states = new Map(roomAgentStates(channel).map(s => [s.agentId, s]));
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<keyof typeof TABS>('story');
  const { user } = useSession();
  const cards = channel?.messages.filter(m => m.kind === 'card').length ?? 0;
  const anyBusy = [...states.values()].some(s => BUSY_STATES.has(s.state));

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const agents = (
    <ul className="flex flex-col gap-2.5" data-tour="agents">
      {(Object.keys(AGENTS) as AgentKey[]).map(k => {
        const s = states.get(k);
        const busy = !!s && BUSY_STATES.has(s.state);
        const detail = s ? chipDetail(s, now) : undefined;
        return (
          <li key={k} className={cn('flex items-center gap-3 rounded-[18px] border p-3 transition-colors', busy ? LIT[k] : 'border-text/15 bg-text/[0.04]')}>
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

  const heading = (
    <div>
      <h2 className="font-poster text-3xl tracking-wide uppercase">Crew HQ</h2>
      <p className="mt-0.5 text-sm text-dim">{anyBusy ? 'Agents at work' : 'Waiting for the next pitch'}</p>
    </div>
  );

  if (!room?.game)
    return (
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
        {heading}
        {agents}
        {room && <YourCrew crewId={room.crewId} />}
        <p className="mt-2 text-sm text-dim">
          Approved plans get their own game room. Open one to see its Story: every decision, who made it, and what it cost.
        </p>
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-4 border-b border-text/10 p-5 pb-4">
        {heading}
        {/* The game's live status chip: the judge tour rings it while Forge and Glitch work. */}
        <div data-tour="agents">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-faint uppercase">Now making</p>
          <div className="mt-2 overflow-hidden rounded-2xl border border-text/15">
            <div className="relative aspect-[16/7]">
              <GameScene seed={room.game.slug} emoji="" colors={paletteFor(room.game.id)} motion={anyBusy ? 'on' : 'off'} className="absolute inset-0" />
            </div>
            <div className="flex items-center justify-between gap-2 bg-text/[0.04] px-3 py-2.5">
              <span className="min-w-0 truncate font-poster text-lg tracking-wide uppercase">{room.game.title}</span>
              <span className="shrink-0 rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-semibold text-brand">
                {STATUS[room.game.status] ?? room.game.status}
              </span>
            </div>
          </div>
        </div>
        <div role="tablist" aria-label="Game panel" className="flex gap-1 rounded-full border border-text/15 bg-text/5 p-1">
          {(Object.keys(TABS) as Array<keyof typeof TABS>).map(t => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => {
                setTab(t);
                if (t === 'story') recordTourFacts('story');
                if (t === 'board') recordTourFacts('leaderboard');
              }}
              {...(t === 'story' && { 'data-tour': 'story' })}
              {...(t === 'board' && { 'data-tour': 'leaderboard' })}
              className={cn(
                'min-h-10 flex-1 rounded-full text-xs font-bold tracking-[0.14em] uppercase transition-colors',
                tab === t ? 'bg-brand text-brand-ink' : 'text-dim hover:text-text',
              )}
            >
              {TABS[t]}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5" role="tabpanel">
        {tab === 'story' ? (
          <StoryTimeline gameId={room.game.id} refreshKey={cards} />
        ) : tab === 'board' ? (
          <Leaderboard gameId={room.game.id} myUserId={user?.id ?? null} refreshKey={cards} />
        ) : (
          agents
        )}
      </div>
    </div>
  );
}

'use client';

// Crew list as crew cards: a little game-world header in the crew's colours (it scrolls while an
// agent works), the name, what's happening ("Forge is building…") or the last message, unread badge.
// Empty state offers a one-tap solo crew (just you + the agents).
import type { CrewSummary } from '@crewarcade/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/brand/Logo';
import { MemberAvatar } from '@/components/identity/MemberAvatar';
import { Avatar, Button, EmptyState, ErrorState, IconButton, Skeleton } from '@/components/ui';
import { GameScene } from '@/components/arcade/GameScene';
import { BUSY_STATES, STATE_LABEL } from '@/lib/agents';
import { api } from '@/lib/api';
import { clockTime, dayLabel, localDay } from '@/lib/chat/grouping';
import { previewText } from '@/lib/chat/normalize';
import { useAllChannels } from '@/lib/chat/store';
import type { ChannelState } from '@/lib/chat/types';
import { cn } from '@/lib/cn';
import { paletteFor } from '@/lib/palette';
import { useCrews } from '@/lib/crews';
import { useNexconn } from '@/lib/nexconn/NexconnProvider';
import { useSession } from '@/lib/session';
import { NewCrewSheet } from './NewCrewSheet';

export function CrewList() {
  const { user } = useSession();
  const { crews, error, refresh, upsert } = useCrews();
  const { store } = useNexconn();
  const channels = useAllChannels(store);
  const pathname = usePathname();
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const [soloBusy, setSoloBusy] = useState(false);
  const [soloError, setSoloError] = useState<string | null>(null);

  const startSolo = async () => {
    setSoloBusy(true);
    setSoloError(null);
    try {
      const crew = await api.createCrew({ name: `${user?.displayName ?? 'My'}'s crew`.slice(0, 40) });
      upsert(crew);
      router.push(`/crews/${crew.id}`);
    } catch (e) {
      setSoloError((e as Error).message);
    } finally {
      setSoloBusy(false);
    }
  };

  // Glitch's DMs (score challenges) appear once there is one.
  const glitch = channels['agentglitch'];
  const glitchLast = glitch?.messages[glitch.messages.length - 1] ?? glitch?.preview ?? null;
  const glitchPreview = glitchLast ? previewText(glitchLast) : 'Score challenges';
  const glitchUnread = pathname === '/messages/glitch' ? 0 : (glitch?.unread ?? 0);
  const sorted = [...(crews ?? [])].sort((a, b) => lastTime(channels[b.groupChannelId], b) - lastTime(channels[a.groupChannelId], a));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-w-0 items-center justify-between gap-1 px-4 py-2">
        <Link href="/crews" aria-label="CrewArcade: your crews" className="min-h-11 content-center">
          <Logo className="text-lg" />
        </Link>
        <div className="flex items-center gap-1">
          <Link
            href="/arcade"
            className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-dim hover:bg-surface-2 hover:text-text"
          >
            Arcade
          </Link>
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            className="inline-flex size-11 items-center justify-center rounded-full text-dim hover:bg-surface-2 hover:text-text"
          >
            {user ? <MemberAvatar person={user} size="sm" /> : <span aria-hidden>⚙️</span>}
          </Link>
        </div>
      </header>
      <div className="flex items-center justify-between gap-2 px-4 pb-2">
        <h1 className="font-poster text-3xl tracking-wide uppercase">Crews</h1>
        <IconButton label="New crew" variant="brand" icon={<span aria-hidden>＋</span>} onClick={() => setSheet(true)} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-safe">
        {error && !crews ? (
          <div className="p-2">
            <ErrorState onRetry={() => void refresh()}>{error}</ErrorState>
          </div>
        ) : !crews ? (
          <div className="space-y-2 p-2" aria-busy aria-label="Loading crews">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : crews.length === 0 ? (
          <>
            {/* Wider screens: the launch pad in the middle has the buttons; here a quiet hint. */}
            <p className="m-2 hidden rounded-[18px] border border-dashed border-text/20 p-4 text-sm text-dim md:block">
              Your crews show up here, each with its latest game and what the agents are doing.
            </p>
            <div className="p-2 md:hidden">
              <EmptyState
                emoji="🕹️"
                title="No crews yet"
                action={
                  <div className="flex w-full flex-col gap-2">
                    <Button size="lg" block loading={soloBusy} onClick={() => void startSolo()}>
                      Start a solo crew
                    </Button>
                    <Button variant="secondary" block onClick={() => setSheet(true)}>
                      Name a crew and invite friends
                    </Button>
                    {soloError && (
                      <p className="text-sm text-danger" role="alert">
                        {soloError}
                      </p>
                    )}
                  </div>
                }
              >
                A solo crew is just you, Pixel, Forge and Glitch: try everything alone, invite friends later. Got an invite link? Open it to join.
              </EmptyState>
            </div>
          </>
        ) : (
          <ul className="flex flex-col gap-3 px-1 pt-1">
            {glitch && (
              <li>
                <Link
                  href="/messages/glitch"
                  aria-current={pathname === '/messages/glitch' ? 'page' : undefined}
                  className={`flex min-h-16 items-center gap-3 rounded-2xl px-3 py-2 ${pathname === '/messages/glitch' ? 'bg-surface-2' : 'hover:bg-surface'}`}
                >
                  <Avatar kind="agent" agent="glitch" size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">Glitch · challenges</span>
                    <span className="block truncate text-sm text-dim">{glitchPreview}</span>
                  </span>
                  {glitchUnread > 0 && (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-brand-ink" aria-label={`${glitchUnread} unread`}>
                      {glitchUnread}
                    </span>
                  )}
                </Link>
              </li>
            )}
            {sorted.map(c => (
              <li key={c.id}>
                <CrewRow crew={c} channel={channels[c.groupChannelId]} active={pathname === `/crews/${c.id}`} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <NewCrewSheet open={sheet} onClose={() => setSheet(false)} />
    </div>
  );
}

const lastTime = (c: ChannelState | undefined, crew: CrewSummary) => {
  const last = c?.messages[c.messages.length - 1] ?? c?.preview;
  return last?.sentTime ?? Date.parse(crew.createdAt);
};

function CrewRow({ crew, channel, active }: { crew: CrewSummary; channel: ChannelState | undefined; active: boolean }) {
  const last = channel?.messages[channel.messages.length - 1] ?? channel?.preview ?? null;
  const unread = active ? 0 : (channel?.unread ?? 0);
  const working = Object.values(channel?.agentStates ?? {}).find(s => BUSY_STATES.has(s.state));
  const when = last ? (localDay(last.sentTime) === localDay(Date.now()) ? clockTime(last.sentTime) : dayLabel(localDay(last.sentTime))) : '';
  const agentName = working ? working.agentId[0]!.toUpperCase() + working.agentId.slice(1) : '';
  return (
    <Link
      href={`/crews/${crew.id}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group block overflow-hidden rounded-[20px] border bg-text/[0.03] transition-colors',
        active ? 'border-brand ring-1 ring-brand' : 'border-text/15 hover:border-text/35',
      )}
    >
      <span aria-hidden className="relative block h-16">
        <GameScene seed={crew.id} emoji="" colors={paletteFor(crew.id)} hud={false} motion={working ? 'on' : 'hover'} className="absolute inset-0" />
        {unread > 0 && (
          <span className="absolute top-2 right-2 min-w-6 rounded-full bg-brand px-1.5 text-center text-xs leading-6 font-bold text-brand-ink">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </span>
      <span className="block px-3 py-2.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-poster text-lg tracking-wide uppercase">{crew.name}</span>
          <span className={cn('shrink-0 text-xs', unread > 0 ? 'font-semibold text-brand' : 'text-faint')}>{when}</span>
        </span>
        {working ? (
          <span className="mt-0.5 flex items-center gap-1.5 text-sm text-brand">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-brand" />
            <span className="truncate">
              {agentName} is {STATE_LABEL[working.state].toLowerCase()}…
            </span>
          </span>
        ) : (
          <span className={cn('mt-0.5 block truncate text-sm', unread > 0 ? 'text-text' : 'text-dim')}>
            {previewText(last) || `${crew.memberCount} members`}
          </span>
        )}
        {unread > 0 && <span className="sr-only">{unread} unread</span>}
      </span>
    </Link>
  );
}

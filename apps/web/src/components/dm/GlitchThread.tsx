'use client';

// Glitch's direct messages: "Riya just beat your best… ▶ Play again". Read-only (agents never act on
// DMs; reply in a crew or game room instead). The [Play again] link opens the game room with the
// player, or the public game page once the game is published.
import { AGENTS, type CrewMember } from '@crewarcade/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { MessageList } from '@/components/chat/MessageList';
import { ImageLightbox } from '@/components/chat/ImageLightbox';
import { Avatar, EmptyState } from '@/components/ui';
import { useChannelState } from '@/lib/chat/store';
import { useNexconn } from '@/lib/nexconn/NexconnProvider';
import { useSession } from '@/lib/session';

export const GLITCH_DM = 'agentglitch';

const GLITCH: CrewMember = {
  id: AGENTS.glitch.id,
  nexconnId: GLITCH_DM,
  displayName: AGENTS.glitch.displayName,
  avatarEmoji: '🧪',
  avatarColor: 'green',
  avatarUrl: AGENTS.glitch.avatarPath,
  isAgent: true,
  role: 'member',
  joinedAt: new Date(0).toISOString(),
};

export function GlitchThread() {
  const nx = useNexconn();
  const { setActiveChannel, loadHistory } = nx;
  const { user } = useSession();
  const channel = useChannelState(nx.store, GLITCH_DM);
  const [image, setImage] = useState<string | null>(null);
  const connected = nx.state === 'connected';
  const members = useMemo(() => new Map<string, CrewMember>([[GLITCH_DM, GLITCH]]), []);

  useEffect(() => {
    setActiveChannel(GLITCH_DM);
    return () => setActiveChannel(null);
  }, [setActiveChannel]);
  useEffect(() => {
    if (connected && !channel?.loaded) void loadHistory(GLITCH_DM);
  }, [connected, channel?.loaded, loadHistory]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-1 py-1.5 sm:px-3">
        <Link
          href="/crews"
          aria-label="Back to crews"
          className="inline-flex size-11 items-center justify-center rounded-full text-dim hover:bg-surface-2 md:hidden"
        >
          <span aria-hidden>←</span>
        </Link>
        <Avatar kind="agent" agent="glitch" size="sm" />
        <div className="min-w-0">
          <p className="truncate font-display font-bold">{AGENTS.glitch.displayName}</p>
          <p className="truncate text-xs text-dim">Score challenges from your crews</p>
        </div>
      </header>
      {channel && (channel.messages.length > 0 || !channel.loaded) ? (
        <MessageList
          channel={channel}
          members={members}
          myId={user?.nexconnId ?? ''}
          targets={[]}
          scrollSignal={0}
          onLoadMore={() => loadHistory(GLITCH_DM)}
          onRetry={() => {}}
          onSeenBy={() => {}}
          onOpenImage={setImage}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState emoji="🧪" title="No challenges yet">
            When someone in your crew beats your best score, Glitch dares you to take it back here.
          </EmptyState>
        </div>
      )}
      <p className="border-t border-border px-4 py-3 text-center text-xs text-dim">
        Glitch doesn&apos;t read replies here. Talk to the agents in your crew chat.
      </p>
      <ImageLightbox url={image} onClose={() => setImage(null)} />
    </div>
  );
}

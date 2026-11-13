'use client';

// One crew's chat: header (members, presence, invite, info), timeline, typing line, composer.
import { AGENTS, type CrewMember } from '@crewarcade/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { agentKeyOf } from '@/components/identity/MemberAvatar';
import { EmptyState, ErrorState, IconButton, Skeleton, useToast } from '@/components/ui';
import { typingUserIds } from '@/lib/chat/reducer';
import { useChannelState, usePresence } from '@/lib/chat/store';
import type { MentionTarget } from '@/lib/chat/text';
import { useCrews } from '@/lib/crews';
import { useNexconn } from '@/lib/nexconn/NexconnProvider';
import { useSession } from '@/lib/session';
import { inviteUrl, shareInvite } from '@/lib/share';
import { ChatComposer } from './ChatComposer';
import { CrewInfoSheet } from './CrewInfoSheet';
import { ImageLightbox } from './ImageLightbox';
import { MessageList } from './MessageList';
import { SeenBySheet } from './SeenBySheet';

export function ChatView({ crewId }: { crewId: string }) {
  const { user } = useSession();
  const { crews, details, loadDetail } = useCrews();
  const nx = useNexconn();
  const { loadHistory, setActiveChannel, watchPresence, retry, seenBy: querySeenBy } = nx;
  const toast = useToast();
  const detail = details[crewId];
  const summary = crews?.find(c => c.id === crewId);
  const channelId = detail?.groupChannelId ?? summary?.groupChannelId ?? null;
  const channel = useChannelState(nx.store, channelId);
  const presence = usePresence(nx.presence);
  const [missing, setMissing] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [seenBy, setSeenBy] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [scrollSignal, setScrollSignal] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const lastMemberRefresh = useRef(0);
  const connected = nx.state === 'connected';

  useEffect(() => {
    void loadDetail(crewId).then(d => setMissing(!d));
  }, [crewId, loadDetail]);

  // This is the open channel: incoming messages here are read, not unread.
  useEffect(() => {
    if (!channelId) return;
    setActiveChannel(channelId);
    return () => setActiveChannel(null);
  }, [channelId, setActiveChannel]);

  useEffect(() => {
    if (connected && channelId && !channel?.loaded) void loadHistory(channelId);
  }, [connected, channelId, channel?.loaded, loadHistory]);

  const members = useMemo(() => new Map<string, CrewMember>((detail?.members ?? []).map(m => [m.nexconnId, m])), [detail?.members]);

  useEffect(() => {
    if (connected && detail) watchPresence(detail.members.filter(m => !m.isAgent).map(m => m.nexconnId));
  }, [connected, detail, watchPresence]);

  // Someone new spoke (joined after we loaded the member list): refresh it, at most every 10 s.
  useEffect(() => {
    if (!detail || !channel) return;
    const unknown = channel.messages.some(m => !members.has(m.senderId));
    if (unknown && Date.now() - lastMemberRefresh.current > 10_000) {
      lastMemberRefresh.current = Date.now();
      void loadDetail(crewId, true);
    }
  }, [channel, detail, members, crewId, loadDetail]);

  // Typing indicators need a clock.
  useEffect(() => {
    if (!channel || Object.keys(channel.typing).length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [channel]);

  const myId = nx.myId ?? user?.nexconnId ?? '';
  const targets: MentionTarget[] = useMemo(
    () =>
      (detail?.members ?? [])
        .filter(m => m.nexconnId !== myId)
        .map(m => {
          const agent = agentKeyOf(m.id);
          return { userId: m.nexconnId, handle: agent ?? m.displayName, label: agent ? AGENTS[agent].displayName : m.displayName, isAgent: !!agent };
        }),
    [detail?.members, myId],
  );

  const onLoadMore = useCallback(async () => {
    if (channelId) await loadHistory(channelId);
  }, [channelId, loadHistory]);
  const onRetry = useCallback((localId: string) => channelId && retry(channelId, localId), [channelId, retry]);
  const loadSeenBy = useCallback((messageId: string) => (channelId ? querySeenBy(channelId, messageId) : Promise.resolve([])), [channelId, querySeenBy]);
  const closeImage = useCallback(() => setImage(null), []);
  const closeSeenBy = useCallback(() => setSeenBy(null), []);

  if (missing && !detail)
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <ErrorState title="Crew not found">You might not be a member of this crew. Ask for an invite link.</ErrorState>
      </div>
    );

  const typing = typingUserIds(channel, myId, now).map(id => members.get(id)?.displayName ?? 'Someone');
  const online = (detail?.members ?? []).filter(m => !m.isAgent && (m.nexconnId === myId || presence[m.nexconnId])).length;

  const share = async () => {
    if (!detail) return;
    const r = await shareInvite(detail.name, inviteUrl(window.location.origin, detail.inviteCode));
    if (r === 'copied') toast('Invite link copied', 'success');
    if (r === 'failed') toast("Couldn't share the link", 'danger');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-1 border-b border-border px-1 py-1.5 sm:px-3">
        <Link
          href="/crews"
          aria-label="Back to crews"
          className="inline-flex size-11 items-center justify-center rounded-full text-dim hover:bg-surface-2 md:hidden"
        >
          <span aria-hidden>←</span>
        </Link>
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          className="min-h-11 min-w-0 flex-1 rounded-2xl px-2 text-left hover:bg-surface-2"
          aria-label="Crew info and members"
        >
          {detail ? (
            <>
              <span className="block truncate font-display font-bold">{detail.name}</span>
              <span className="block truncate text-xs text-dim">
                {detail.members.length} members · {online} online · Pixel, Forge, Glitch
              </span>
            </>
          ) : (
            <Skeleton className="h-5 w-40" />
          )}
        </button>
        <IconButton label="Invite friends" icon={<span aria-hidden>📤</span>} onClick={() => void share()} disabled={!detail} />
        <IconButton label="Crew info" icon={<span aria-hidden>ⓘ</span>} onClick={() => setInfoOpen(true)} disabled={!detail} />
      </header>

      {nx.state === 'unconfigured' ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState emoji="🔌" title="Chat is not connected yet">
            This server has no Nexconn keys yet, so messages can't be sent. Your crew is saved.
          </EmptyState>
        </div>
      ) : (
        <MessageList
          channel={channel}
          members={members}
          myId={myId}
          targets={targets}
          scrollSignal={scrollSignal}
          onLoadMore={onLoadMore}
          onRetry={onRetry}
          onSeenBy={setSeenBy}
          onOpenImage={setImage}
        />
      )}

      <p className="min-h-6 truncate px-4 text-xs text-dim" aria-live="polite">
        {typing.length === 1
          ? `${typing[0]} is typing…`
          : typing.length === 2
            ? `${typing[0]} and ${typing[1]} are typing…`
            : typing.length > 2
              ? `${typing.length} people are typing…`
              : ''}
      </p>
      {channelId && (
        <ChatComposer
          targets={targets}
          disabled={!connected}
          onTyping={() => nx.sendTyping(channelId)}
          onSendText={(text, ids) => {
            nx.sendText(channelId, text, ids);
            setScrollSignal(s => s + 1);
          }}
          onSendImage={file => {
            nx.sendImage(channelId, file);
            setScrollSignal(s => s + 1);
          }}
          onSendVoice={(file, d) => {
            nx.sendVoice(channelId, file, d);
            setScrollSignal(s => s + 1);
          }}
        />
      )}

      {detail && user && <CrewInfoSheet open={infoOpen} onClose={() => setInfoOpen(false)} crew={detail} myDbId={user.id} presence={presence} />}
      <SeenBySheet messageId={seenBy} onClose={closeSeenBy} load={loadSeenBy} members={members} />
      <ImageLightbox url={image} onClose={closeImage} />
    </div>
  );
}

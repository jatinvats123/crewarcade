'use client';

// One room of a crew: the crew chat or a game room. Header (members, presence, invite, info), room
// tabs, Agent Status Strip, timeline (with cards and streamed agent replies), typing line, composer.
import { AGENTS, type CrewMember } from '@crewarcade/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentStatusStrip } from '@/components/agents/AgentStatusStrip';
import { CardEnvProvider, type CardEnv } from '@/components/cards/context';
import { agentKeyOf } from '@/components/identity/MemberAvatar';
import { Leaderboard } from '@/components/play/Leaderboard';
import { usePlayer } from '@/components/player/PlayerProvider';
import { StoryTimeline } from '@/components/story/StoryTimeline';
import { EmptyState, ErrorState, IconButton, Sheet, Skeleton, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { typingUserIds } from '@/lib/chat/reducer';
import { useChannelState, usePresence } from '@/lib/chat/store';
import type { MentionTarget } from '@/lib/chat/text';
import { useCrews } from '@/lib/crews';
import { useNexconn } from '@/lib/nexconn/NexconnProvider';
import { activeRoomStore, roomHref } from '@/lib/room';
import { useSession } from '@/lib/session';
import { inviteUrl, shareInvite } from '@/lib/share';
import { ChatComposer } from './ChatComposer';
import { CrewInfoSheet } from './CrewInfoSheet';
import { ImageLightbox } from './ImageLightbox';
import { MessageList } from './MessageList';
import { SeenBySheet } from './SeenBySheet';

export function ChatView({ crewId, roomChannelId }: { crewId: string; roomChannelId?: string }) {
  const { user } = useSession();
  const { crews, details, loadDetail } = useCrews();
  const nx = useNexconn();
  const { loadHistory, setActiveChannel, watchPresence, retry, seenBy: querySeenBy } = nx;
  const toast = useToast();
  const detail = details[crewId];
  const summary = crews?.find(c => c.id === crewId);
  const crewChannelId = detail?.groupChannelId ?? summary?.groupChannelId ?? null;
  const channelId = roomChannelId ?? crewChannelId;
  const channel = useChannelState(nx.store, channelId);
  const game = roomChannelId ? (detail?.games.find(g => g.roomChannelId === roomChannelId) ?? null) : null;
  const rooms = (detail?.games ?? []).filter(g => g.roomChannelId);
  const [storyOpen, setStoryOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const player = usePlayer();
  const searchParams = useSearchParams();
  const playParam = searchParams.get('play');
  // Deep link from Glitch's challenge DM / a share: ?play=latest (or ?play=<version>) opens the player.
  const deepLinked = useRef<string | null>(null);
  useEffect(() => {
    if (!game || !playParam || deepLinked.current === `${game.id}:${playParam}`) return;
    deepLinked.current = `${game.id}:${playParam}`;
    const v = playParam === 'latest' ? 'latest' : Number(playParam);
    if (v === 'latest' || (Number.isInteger(v) && v > 0)) player.open({ gameId: game.id, version: v, title: game.title });
  }, [game, playParam, player]);
  const [storyKey, setStoryKey] = useState(0);
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

  // The desktop context panel follows the room on screen.
  useEffect(() => {
    if (!channelId) return;
    activeRoomStore.dispatch({ type: 'set', room: { crewId, channelId, game } });
  }, [crewId, channelId, game]);
  useEffect(() => () => activeRoomStore.dispatch({ type: 'set', room: null }), []);

  // Agents already working when the room opens: the server's snapshot (heartbeats keep it fresh).
  useEffect(() => {
    if (!channelId || !connected) return;
    let live = true;
    api
      .roomAgents(channelId)
      .then(states => {
        if (live) for (const st of states) nx.store.dispatch({ type: 'agent/state', channelId, state: st, receivedAt: Date.now() });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [channelId, connected, nx.store]);

  // A card about a room we don't know yet (a plan was just approved): refresh the crew's games.
  // Any new card also refreshes the Story.
  const cardCount = channel?.messages.filter(m => m.kind === 'card').length ?? 0;
  const lastGamesRefresh = useRef(0);
  useEffect(() => {
    if (!detail || !channel) return;
    const known = (c: string | undefined) => !c || detail.games.some(g => g.roomChannelId === c);
    const unknown = channel.messages.some(
      m => (m.card?.kind === 'roomLink' && !known(m.card.content.channelId)) || (m.card?.kind === 'plan' && !known(m.meta?.roomChannelId)),
    );
    if (unknown && Date.now() - lastGamesRefresh.current > 3000) {
      lastGamesRefresh.current = Date.now();
      void loadDetail(crewId, true);
    }
  }, [channel, detail, crewId, loadDetail]);
  useEffect(() => setStoryKey(k => k + 1), [cardCount]);

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
  const cardEnv: CardEnv = useMemo(
    () => ({
      crewId,
      myId,
      canApprove: detail?.role === 'owner' || detail?.role === 'approver',
      roomHref: (c: string) => roomHref(crewId, c, crewChannelId ?? ''),
      actions: {
        vote: api.vote,
        approve: api.approve,
        requestChange: api.requestChange,
        retryBuild: api.retryBuild,
        publish: api.publish,
        askForFix: api.askForFix,
        play: (gameId, version, title) => player.open({ gameId, version, ...(title && { title }) }),
      },
      setMeta: (channelId, messageId, metadata, replace) => nx.store.dispatch({ type: 'message/metadata', channelId, messageId, metadata, replace }),
    }),
    [crewId, myId, detail?.role, crewChannelId, nx.store, player],
  );
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

  if (detail && roomChannelId && !game)
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <ErrorState title="Room not found">This game room isn't part of the crew. Go back to the crew chat.</ErrorState>
      </div>
    );
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
          href={roomChannelId ? `/crews/${crewId}` : '/crews'}
          aria-label={roomChannelId ? 'Back to the crew chat' : 'Back to crews'}
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
              <span className="block truncate font-display font-bold">{game ? `🎮 ${game.title}` : detail.name}</span>
              <span className="block truncate text-xs text-dim">
                {game ? `Game room · ${detail.name} · ${online} online` : `${detail.members.length} members · ${online} online · Pixel, Forge, Glitch`}
              </span>
            </>
          ) : (
            <Skeleton className="h-5 w-40" />
          )}
        </button>
        {game && game.status !== 'planning' && (
          <IconButton
            label={`Play ${game.title}`}
            variant="filled"
            icon={<span aria-hidden>▶</span>}
            onClick={() => player.open({ gameId: game.id, version: 'latest', title: game.title })}
            data-testid="room-play"
          />
        )}
        {game && (
          <span className="flex lg:hidden">
            <IconButton label="Leaderboard" icon={<span aria-hidden>🏆</span>} onClick={() => setBoardOpen(true)} />
            <IconButton label="Story: how this game was made" icon={<span aria-hidden>📜</span>} onClick={() => setStoryOpen(true)} />
          </span>
        )}
        <IconButton label="Invite friends" icon={<span aria-hidden>📤</span>} onClick={() => void share()} disabled={!detail} />
        <IconButton label="Crew info" icon={<span aria-hidden>ⓘ</span>} onClick={() => setInfoOpen(true)} disabled={!detail} />
      </header>
      {rooms.length > 0 && crewChannelId && (
        <nav aria-label="Rooms" className="flex gap-1.5 overflow-x-auto border-b border-border px-2 py-1.5 [scrollbar-width:none] sm:px-3">
          {[{ id: crewChannelId, label: '💬 Crew chat' }, ...rooms.map(g => ({ id: g.roomChannelId!, label: `🎮 ${g.title}` }))].map(r => (
            <Link
              key={r.id}
              href={roomHref(crewId, r.id, crewChannelId)}
              aria-current={r.id === channelId ? 'page' : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-3 text-sm font-semibold ${r.id === channelId ? 'border-brand bg-brand/15 text-brand' : 'border-border text-dim hover:text-text'}`}
            >
              {r.label}
            </Link>
          ))}
        </nav>
      )}
      <AgentStatusStrip channel={channel} crewId={crewId} />

      {nx.state === 'unconfigured' ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState emoji="🔌" title="Chat is not connected yet">
            This server has no Nexconn keys yet, so messages can't be sent. Your crew is saved.
          </EmptyState>
        </div>
      ) : (
        <CardEnvProvider value={cardEnv}>
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
        </CardEnvProvider>
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
      {game && (
        <Sheet open={boardOpen} onClose={() => setBoardOpen(false)} title={`🏆 ${game.title}`}>
          <Leaderboard gameId={game.id} myUserId={user?.id ?? null} />
        </Sheet>
      )}
      {game && (
        <Sheet open={storyOpen} onClose={() => setStoryOpen(false)} title={`Story of ${game.title}`}>
          <StoryTimeline gameId={game.id} refreshKey={storyKey} />
        </Sheet>
      )}
      <SeenBySheet messageId={seenBy} onClose={closeSeenBy} load={loadSeenBy} members={members} />
      <ImageLightbox url={image} onClose={closeImage} />
    </div>
  );
}

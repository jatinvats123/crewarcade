'use client';

// The timeline. Scrolling uses a column-reverse container with a single child: the browser keeps it
// anchored to the bottom natively (new messages stay in view, older pages load above without a
// jump), with no scroll math. Rendering is virtualized by the browser: every sender group has
// `content-visibility: auto`, so off-screen groups skip layout and paint, and history is paged
// (30 per page) instead of loaded all at once.
import type { CrewMember } from '@crewarcade/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MessageSkeleton } from '@/components/ui';
import { dayLabel, groupTimeline } from '@/lib/chat/grouping';
import type { MentionTarget } from '@/lib/chat/text';
import type { ChannelState } from '@/lib/chat/types';
import { SenderGroupView } from './MessageGroup';

export interface MessageListProps {
  channel: ChannelState | undefined;
  members: Map<string, CrewMember>;
  myId: string;
  targets: MentionTarget[];
  /** Bumped by the parent after I send something: jump to the latest message. */
  scrollSignal: number;
  onLoadMore: () => Promise<void>;
  onRetry: (localId: string) => void;
  onSeenBy: (messageId: string) => void;
  onOpenImage: (url: string) => void;
  /** Shown at the very start of the history (a new crew's welcome) instead of the plain start line. */
  intro?: React.ReactNode;
}

export function MessageList({ channel, members, myId, targets, scrollSignal, onLoadMore, onRetry, onSeenBy, onOpenImage, intro }: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [away, setAway] = useState(false);
  const [seenCount, setSeenCount] = useState(0);
  const messages = useMemo(() => channel?.messages ?? [], [channel?.messages]);
  const days = useMemo(() => groupTimeline(messages), [messages]);
  const hasMore = channel?.hasMore ?? true;
  const loaded = channel?.loaded ?? false;

  // Older pages when the top comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !loaded || !hasMore) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting) && !loadingMore) {
          setLoadingMore(true);
          void onLoadMore().finally(() => setLoadingMore(false));
        }
      },
      { root: scroller.current, rootMargin: '300px 0px 0px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loaded, hasMore, loadingMore, onLoadMore]);

  // column-reverse: scrollTop is 0 at the bottom and negative above it.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const isAway = Math.abs(el.scrollTop) > 160;
    if (isAway !== away) {
      setAway(isAway);
      if (isAway) setSeenCount(messages.length);
    }
  };

  useLayoutEffect(() => {
    if (scrollSignal > 0) scroller.current?.scrollTo({ top: 0 });
  }, [scrollSignal]);

  const fresh = away ? messages.slice(seenCount).filter(m => m.direction === 'in').length : 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain">
        <div role="log" aria-label="Messages" aria-relevant="additions" className="flex flex-col gap-2 px-3 pt-3 pb-2 sm:px-5">
          <div ref={sentinel} className="flex min-h-8 items-center justify-center">
            {!loaded ? null : hasMore ? (
              loadingMore && <span className="text-xs text-faint">Loading earlier messages…</span>
            ) : intro ? (
              <div className="w-full">{intro}</div>
            ) : (
              <span className="text-xs text-faint">This is the start of your crew's chat</span>
            )}
          </div>
          {!loaded ? (
            <div className="space-y-4" aria-busy>
              <MessageSkeleton />
              <MessageSkeleton />
              <MessageSkeleton />
            </div>
          ) : (
            days.map(d => (
              <section key={d.day} aria-label={dayLabel(d.day)} className="flex flex-col gap-2">
                <div className="sticky top-1 z-[1] flex justify-center py-1">
                  <span className="rounded-full border border-border bg-surface/90 px-3 py-0.5 text-xs font-semibold text-dim backdrop-blur">
                    {dayLabel(d.day)}
                  </span>
                </div>
                {d.items.map(item =>
                  item.type === 'notice' ? (
                    item.message.notice?.kind === 'shield' ? (
                      <a
                        key={item.message.key}
                        href="/safety"
                        className="mx-auto flex max-w-[85%] items-center gap-2 rounded-2xl border border-glitch/40 bg-glitch/10 px-3 py-2 text-left text-xs text-text"
                      >
                        <span className="text-[0.7rem] font-bold tracking-[0.12em] text-glitch uppercase">Shield</span>
                        <span>{item.message.notice.text}</span>
                      </a>
                    ) : (
                      <p key={item.message.key} className="mx-auto max-w-[85%] rounded-full bg-surface-2 px-3 py-1 text-center text-xs text-dim">
                        {item.message.notice?.text}
                      </p>
                    )
                  ) : (
                    <SenderGroupView
                      key={item.group.key}
                      group={item.group}
                      sender={members.get(item.group.senderId)}
                      isMe={item.group.senderId === myId}
                      targets={targets}
                      onRetry={onRetry}
                      onSeenBy={onSeenBy}
                      onOpenImage={onOpenImage}
                    />
                  ),
                )}
              </section>
            ))
          )}
        </div>
      </div>
      {away && (
        <button
          type="button"
          onClick={() => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="animate-slide-up absolute bottom-3 left-1/2 inline-flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold shadow-card"
        >
          <span aria-hidden>↓</span>
          {fresh > 0 ? `${fresh} new message${fresh > 1 ? 's' : ''}` : 'Jump to latest'}
        </button>
      )}
    </div>
  );
}

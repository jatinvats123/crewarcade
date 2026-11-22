'use client';

// Places in the app shell where the judge tour renders (the card is portalled in by <JudgeTour />),
// and the observer that turns chat cards into tour ticks. Both do nothing for non-judges.
import { useCallback, useEffect, useRef } from 'react';
import { ScrollMore } from '@/components/ui';
import { useAllChannels } from '@/lib/chat/store';
import { useNexconn } from '@/lib/nexconn/NexconnProvider';
import { factsFromMessages } from '@/lib/tour/steps';
import { recordTourFacts, setTourSlot, useTour, type TourSlotKind } from '@/lib/tour/store';

/** scroll: the slot scrolls on its own and shows "More below ↓" while there is more (desktop panel). */
export function TourSlot({
  kind,
  className,
  wrapperClassName,
  scroll = false,
}: {
  kind: TourSlotKind;
  className?: string;
  wrapperClassName?: string;
  scroll?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const attach = useCallback((el: HTMLDivElement | null) => setTourSlot(kind, el), [kind]);
  useEffect(() => {
    if (scroll) return;
    setTourSlot(kind, ref.current);
    return () => setTourSlot(kind, null);
  }, [kind, scroll]);
  return scroll ? <ScrollMore scrollerRef={attach} className={className} wrapperClassName={wrapperClassName} /> : <div ref={ref} className={className} />;
}

/** Real chat events → tour facts (plan cards, approvals, builds, tests, publishes, bugs, shield). */
export function TourChatObserver() {
  const tour = useTour();
  return tour ? <ChatFacts /> : null;
}

function ChatFacts() {
  const { store } = useNexconn();
  const channels = useAllChannels(store);
  useEffect(() => {
    const facts = factsFromMessages(Object.values(channels).flatMap(c => c.messages));
    if (facts.length) recordTourFacts(...facts);
  }, [channels]);
  return null;
}

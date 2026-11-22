'use client';

// A scroll area that says so: while there is more below, a fade and a "More below ↓" button sit at
// its bottom edge (tap to scroll on); they go away at the end. Used for the desktop right panel
// (Crew HQ and the judge tour), where the last cards are easy to miss.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface ScrollMoreProps {
  /** Classes of the scrolling element (it gets overflow-y-auto). */
  className?: string;
  /** Classes of the wrapper that holds the scroller and the hint (sizing in the parent layout). */
  wrapperClassName?: string;
  children?: ReactNode;
  /** Receives the scrolling element (e.g. a portal target). */
  scrollerRef?: (el: HTMLDivElement | null) => void;
  /** Extra attributes for the scroller. */
  role?: string;
}

/** Pixels left below before we call it the end (rounding, borders). */
const END_SLACK = 8;

export function ScrollMore({ className, wrapperClassName, children, scrollerRef, role }: ScrollMoreProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);

  const setEl = useCallback(
    (node: HTMLDivElement | null) => {
      el.current = node;
      scrollerRef?.(node);
    },
    [scrollerRef],
  );

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const update = () => setMore(node.scrollHeight - node.scrollTop - node.clientHeight > END_SLACK);
    update();
    node.addEventListener('scroll', update, { passive: true });
    // Content grows and shrinks (cards arrive, tabs switch, the tour moves on): re-check.
    const ro = new ResizeObserver(update);
    ro.observe(node);
    const mo = new MutationObserver(update);
    mo.observe(node, { childList: true, subtree: true, characterData: true });
    return () => {
      node.removeEventListener('scroll', update);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <div className={cn('relative flex min-h-0 flex-col', wrapperClassName)}>
      <div ref={setEl} role={role} className={cn('min-h-0 overflow-y-auto', className)}>
        {children}
      </div>
      {more && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center bg-gradient-to-t from-bg via-bg/80 to-transparent pb-2">
          <button
            type="button"
            onClick={() => el.current?.scrollBy({ top: Math.round(el.current.clientHeight * 0.7), behavior: 'smooth' })}
            className="pointer-events-auto inline-flex min-h-11 items-center gap-1.5 rounded-full border border-text/20 bg-surface px-4 text-xs font-semibold shadow-card hover:border-brand hover:text-brand"
            data-testid="scroll-more"
          >
            More below{' '}
            <span aria-hidden className="inline-block animate-bounce motion-reduce:animate-none">
              ↓
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

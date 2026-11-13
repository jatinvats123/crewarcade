'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Bottom sheet on phones, centered dialog from sm: up. Esc and the backdrop close it; focus moves
 * into the sheet on open and back to the trigger on close.
 */
export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button type="button" aria-label="Close" className="animate-fade-in absolute inset-0 bg-overlay backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'animate-slide-up relative flex max-h-[85dvh] w-full flex-col rounded-t-3xl border border-border bg-surface shadow-card outline-none',
          'sm:max-w-md sm:rounded-3xl',
        )}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-surface-3 sm:hidden" aria-hidden />
        <h2 id={titleId} className="px-5 pt-3 pb-2 font-display text-lg font-bold">
          {title}
        </h2>
        <div className="overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="pb-safe flex flex-col gap-2 border-t border-border px-5 pt-3 sm:pb-4">{footer}</div>}
      </div>
    </div>
  );
}

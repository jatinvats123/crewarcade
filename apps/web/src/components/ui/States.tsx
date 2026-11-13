import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('block animate-pulse rounded-xl bg-surface-2', className)} />;
}

/** A chat-message-shaped skeleton for loading timelines. */
export function MessageSkeleton() {
  return (
    <div className="flex gap-3" aria-label="Loading" role="status">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-16 w-full max-w-sm" />
      </div>
    </div>
  );
}

export function EmptyState({ emoji = '🕹️', title, children, action }: { emoji?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border px-6 py-10 text-center">
      <span className="text-4xl" aria-hidden>
        {emoji}
      </span>
      <h3 className="font-display text-lg font-bold">{title}</h3>
      {children && <p className="max-w-xs text-sm text-dim">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', children, onRetry }: { title?: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-card border border-danger/40 bg-danger/8 px-6 py-8 text-center">
      <span className="text-3xl" aria-hidden>
        👾
      </span>
      <h3 className="font-display text-lg font-bold">{title}</h3>
      {children && <p className="max-w-xs text-sm text-dim">{children}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="min-h-11 rounded-2xl border border-border bg-surface px-4 font-semibold hover:bg-surface-2">
          Try again
        </button>
      )}
    </div>
  );
}

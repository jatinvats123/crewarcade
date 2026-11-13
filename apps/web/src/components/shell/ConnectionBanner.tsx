'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { useNexconn } from '@/lib/nexconn/NexconnProvider';

/** Connecting / offline / back online. "Back online" shows for 2.5 s after a reconnect. */
export function ConnectionBanner() {
  const { state, reconnectedAt, retryConnect } = useNexconn();
  const [showBack, setShowBack] = useState(false);

  useEffect(() => {
    if (!reconnectedAt) return;
    setShowBack(true);
    const t = setTimeout(() => setShowBack(false), 2500);
    return () => clearTimeout(t);
  }, [reconnectedAt]);

  let text: string | null = null;
  let tone: 'info' | 'warn' | 'ok' | 'danger' = 'info';
  let action: { label: string; run: () => void } | null = null;
  switch (state) {
    case 'connecting':
      text = 'Connecting to chat…';
      break;
    case 'reconnecting':
    case 'offline':
      text = "You're offline. Reconnecting…";
      tone = 'warn';
      break;
    case 'kicked':
      text = 'CrewArcade was opened in another place with this account.';
      tone = 'danger';
      action = { label: 'Use it here', run: retryConnect };
      break;
    case 'error':
      text = "Couldn't connect to chat.";
      tone = 'danger';
      action = { label: 'Try again', run: retryConnect };
      break;
    case 'unconfigured':
      text = "Chat isn't set up on this server yet.";
      tone = 'warn';
      break;
    case 'connected':
      if (showBack) {
        text = 'Back online';
        tone = 'ok';
      }
      break;
  }
  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {text && (
        <div
          className={cn(
            'animate-fade-in flex min-h-9 items-center justify-center gap-3 px-4 py-1.5 text-center text-sm font-semibold',
            tone === 'info' && 'bg-surface-2 text-dim',
            tone === 'warn' && 'bg-warning/15 text-warning',
            tone === 'ok' && 'bg-success/15 text-success',
            tone === 'danger' && 'bg-danger/15 text-danger',
          )}
        >
          <span>{text}</span>
          {action && (
            <button type="button" onClick={action.run} className="min-h-9 rounded-full border border-current px-3 text-xs">
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

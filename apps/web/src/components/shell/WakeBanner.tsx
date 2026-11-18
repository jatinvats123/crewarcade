'use client';

// "Waking up the server…": shown while the API client waits for the sleeping free server (lib/wake).
import { useEffect, useState } from 'react';
import { onWaking } from '@/lib/wake';

export function WakeBanner() {
  const [waking, setWaking] = useState(false);
  useEffect(() => onWaking(setWaking), []);
  if (!waking) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="wake-banner"
      className="fixed inset-x-0 top-0 z-[70] flex justify-center px-4 pt-[max(env(safe-area-inset-top),0.5rem)]"
    >
      <p className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold shadow-card">
        <span className="size-2 animate-pulse rounded-full bg-gold" aria-hidden />
        Waking up the server… this can take up to a minute.
      </p>
    </div>
  );
}

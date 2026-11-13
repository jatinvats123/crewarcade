'use client';

import { useEffect, useRef } from 'react';
import { IconButton } from '@/components/ui';

/** Full-screen photo viewer: pinch to zoom on phones, Esc / tap outside / ✕ to close. */
export function ImageLightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!url) return;
    const prev = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [url, onClose]);
  if (!url) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <div className="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-2 flex gap-1">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-white hover:bg-white/10"
        >
          Open original
        </a>
        <IconButton
          ref={close}
          label="Close photo"
          icon={
            <span aria-hidden className="text-white">
              ✕
            </span>
          }
          onClick={onClose}
          className="hover:bg-white/10"
        />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- user media */}
      <img src={url} alt="Photo" className="max-h-full max-w-full touch-pinch-zoom object-contain" onClick={e => e.stopPropagation()} />
    </div>
  );
}

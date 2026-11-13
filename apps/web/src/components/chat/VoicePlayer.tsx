'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration } from '@/lib/chat/normalize';
import { cn } from '@/lib/cn';

const BARS = 28;

/** Deterministic "waveform" bars from the message key (no audio analysis needed). */
export function waveform(seed: string, n = BARS): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: n }, (_, i) => {
    h = Math.imul(h ^ (h >>> 13), 1274126177) + i;
    const v = ((h >>> 0) % 1000) / 1000;
    return 0.25 + 0.75 * Math.abs(Math.sin((i / n) * Math.PI)) * (0.45 + 0.55 * v);
  });
}

export function VoicePlayer({ url, durationS, seed, isMe }: { url: string; durationS: number; seed: string; isMe: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);
  const bars = useMemo(() => waveform(seed), [seed]);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const tick = () => {
      const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : durationS || 1;
      setProgress(Math.min(1, a.currentTime / d));
      setCurrent(a.currentTime);
    };
    const end = () => {
      setPlaying(false);
      setProgress(0);
      setCurrent(0);
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    a.addEventListener('timeupdate', tick);
    a.addEventListener('ended', end);
    a.addEventListener('pause', onPause);
    a.addEventListener('play', onPlay);
    return () => {
      a.removeEventListener('timeupdate', tick);
      a.removeEventListener('ended', end);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('play', onPlay);
    };
  }, [durationS]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) {
      // One voice note at a time.
      document.querySelectorAll('audio').forEach(other => other !== a && other.pause());
      void a.play().catch(() => setPlaying(false));
    } else a.pause();
  };

  return (
    <div className={cn('flex min-w-[220px] items-center gap-2 rounded-3xl px-2 py-1.5', isMe ? 'rounded-br-lg bg-brand/18' : 'rounded-bl-lg bg-surface-2')}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-ink active:scale-90"
      >
        <span aria-hidden className="text-sm">
          {playing ? '❚❚' : '▶'}
        </span>
      </button>
      <div className="flex h-8 flex-1 items-center gap-[2px]" aria-hidden>
        {bars.map((b, i) => (
          <span
            key={i}
            className={cn('w-[3px] rounded-full', i / bars.length < progress ? 'bg-brand' : 'bg-faint/60')}
            style={{ height: `${Math.round(b * 100)}%` }}
          />
        ))}
      </div>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-dim">{formatDuration(playing || current > 0 ? current : durationS)}</span>
      <audio ref={audio} src={url} preload="none" />
    </div>
  );
}

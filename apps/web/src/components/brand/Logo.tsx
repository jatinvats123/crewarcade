import { cn } from '@/lib/cn';

/** The CrewArcade wordmark: a joystick-dot mark + "Crew" / "Arcade" in the display font. */
export function Logo({ className, showMark = true }: { className?: string; showMark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-display font-bold tracking-tight', className)} aria-label="CrewArcade">
      {showMark && <LogoMark className="size-[1.3em]" />}
      <span aria-hidden>
        Crew<span className="text-brand">Arcade</span>
      </span>
    </span>
  );
}

/** Square mark: three agent-coloured dots (Pixel, Forge, Glitch) on an arcade button. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--brand)" />
      <circle cx="10" cy="12" r="3.4" fill="var(--pixel)" stroke="#fff" strokeWidth="1.4" />
      <circle cx="22" cy="12" r="3.4" fill="var(--forge)" stroke="#fff" strokeWidth="1.4" />
      <circle cx="16" cy="21.5" r="3.4" fill="var(--glitch)" stroke="#fff" strokeWidth="1.4" />
    </svg>
  );
}

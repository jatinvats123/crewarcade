import type { AgentKey } from '@crewarcade/shared';
import { AGENTS } from '@crewarcade/shared';
import type { ReactNode } from 'react';
import { ACCENT_TEXT } from '@/lib/agents';
import { cn } from '@/lib/cn';
import { Avatar } from './Avatar';
import { AiBadge } from './Badge';

// A thin bar in the agent's colour along the top edge: who posted it, at a glance. No glow, no blur.
const BAR: Record<AgentKey, string> = { pixel: 'bg-pixel', forge: 'bg-forge', glitch: 'bg-glitch' };

export interface CardShellProps {
  /** The agent that posted the card (null for system / human cards). */
  agent?: AgentKey | null;
  title: ReactNode;
  /** e.g. "v2 · 2 min ago" */
  meta?: ReactNode;
  badges?: ReactNode;
  /** Full-bleed art above the header (the game's cover). */
  cover?: ReactNode;
  children?: ReactNode;
  /** Action row (buttons). Stacks full-width on mobile. */
  actions?: ReactNode;
  className?: string;
}

/** The shell every chat card uses: optional cover, header (agent, AI badge, poster title, meta, badges), body, action row. */
export function CardShell({ agent, title, meta, badges, cover, children, actions, className }: CardShellProps) {
  return (
    <article className={cn('relative animate-slide-up overflow-hidden rounded-[22px] border border-border bg-surface shadow-card', className)}>
      {agent && !cover && <span aria-hidden className={cn('absolute inset-x-0 top-0 h-[3px]', BAR[agent])} />}
      {cover && <div className="relative aspect-[21/8] overflow-hidden border-b border-border">{cover}</div>}
      <header className="p-4 pb-3 sm:px-5 sm:pt-5">
        {agent && (
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <Avatar kind="agent" agent={agent} size="sm" />
              <span className={cn('truncate text-xs font-semibold tracking-[0.14em] uppercase', ACCENT_TEXT[agent])}>{AGENTS[agent].displayName}</span>
            </span>
            <AiBadge />
          </div>
        )}
        <h3 className="font-poster text-2xl leading-[1.05] tracking-wide break-words uppercase sm:text-[28px]">{title}</h3>
        {meta && <p className="mt-1 text-xs text-faint">{meta}</p>}
        {/* Under the title, so long status text never squeezes the title on a phone. */}
        {badges && <div className="mt-2 flex flex-wrap gap-1.5">{badges}</div>}
      </header>
      {/* overflow-wrap:anywhere: test details carry long unbroken JSON that must wrap, not widen the card. */}
      {children && <div className="min-w-0 px-4 pb-4 text-sm [overflow-wrap:anywhere] text-text sm:px-5">{children}</div>}
      {actions && (
        <footer className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:px-5">
          {actions}
        </footer>
      )}
    </article>
  );
}

/** A labelled block inside a card ("Controls", "Play"): small caps label over the text. */
export function CardFact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-border bg-surface-2/60 px-3.5 py-3', className)}>
      <p className="text-[11px] font-semibold tracking-[0.16em] text-faint uppercase">{label}</p>
      <div className="mt-1 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

/** Glitch's checklist look: code font, one row per check, a status mark on the left. */
export function CheckList({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-glitch/25 bg-bg/60 px-3.5 py-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] text-glitch uppercase">{label}</div>
      <ul className="mt-2 flex flex-col gap-1.5 font-mono text-[13px] leading-snug">{children}</ul>
    </div>
  );
}

export function CheckMark({ state }: { state: 'todo' | 'pass' | 'fail' }) {
  if (state === 'pass')
    return (
      <span aria-label="passed" className="mt-px flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-success text-[10px] font-bold text-bg">
        ✓
      </span>
    );
  if (state === 'fail')
    return (
      <span aria-label="failed" className="mt-px flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-danger text-[10px] font-bold text-bg">
        ✕
      </span>
    );
  return <span aria-hidden className="mt-px size-4 shrink-0 rounded-[5px] border border-glitch/50" />;
}

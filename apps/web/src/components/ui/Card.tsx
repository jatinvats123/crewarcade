import type { AgentKey } from '@crewarcade/shared';
import { AGENTS } from '@crewarcade/shared';
import type { ReactNode } from 'react';
import { ACCENT_TEXT } from '@/lib/agents';
import { cn } from '@/lib/cn';
import { Avatar } from './Avatar';
import { AiBadge } from './Badge';

export interface CardShellProps {
  /** The agent that posted the card (null for system / human cards). */
  agent?: AgentKey | null;
  title: ReactNode;
  /** e.g. "v2 · 2 min ago" */
  meta?: ReactNode;
  badges?: ReactNode;
  children?: ReactNode;
  /** Action row (buttons). Stacks full-width on mobile. */
  actions?: ReactNode;
  className?: string;
}

/** The shell every chat card uses: header (agent avatar, name, meta, badges), body, action row. */
export function CardShell({ agent, title, meta, badges, children, actions, className }: CardShellProps) {
  return (
    <article className={cn('animate-slide-up overflow-hidden rounded-card border border-border bg-surface shadow-card', className)}>
      <header className="flex items-start gap-3 p-4 pb-2">
        {agent ? <Avatar kind="agent" agent={agent} size="sm" /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            {agent && <p className={cn('text-xs font-semibold', ACCENT_TEXT[agent])}>{AGENTS[agent].displayName}</p>}
            {agent && <AiBadge />}
          </div>
          <h3 className="font-display text-base leading-snug font-bold">{title}</h3>
          {meta && <p className="text-xs text-faint">{meta}</p>}
          {/* Under the title, so long status text never squeezes the title on a phone. */}
          {badges && <div className="mt-1.5 flex flex-wrap gap-1">{badges}</div>}
        </div>
      </header>
      {children && <div className="px-4 pb-3 text-sm text-text">{children}</div>}
      {actions && <footer className="flex flex-col gap-2 border-t border-border bg-surface-2/50 p-3 sm:flex-row sm:justify-end">{actions}</footer>}
    </article>
  );
}

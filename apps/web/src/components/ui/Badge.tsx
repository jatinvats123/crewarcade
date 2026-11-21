import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'brand' | 'pixel' | 'forge' | 'glitch' | 'success' | 'danger' | 'gold';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-dim border-border',
  brand: 'bg-brand/15 text-brand border-brand/30',
  pixel: 'bg-pixel/15 text-pixel border-pixel/30',
  forge: 'bg-forge/15 text-forge border-forge/30',
  glitch: 'bg-glitch/15 text-glitch border-glitch/30',
  success: 'bg-success/15 text-success border-success/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
  gold: 'bg-gold/15 text-gold border-gold/30',
};

export function Badge({ tone = 'neutral', icon, children, className }: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap', TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

/** Crew role badge. Members get none (the default). */
export function RoleBadge({ role }: { role: 'owner' | 'approver' | 'member' }) {
  if (role === 'member') return null;
  return <Badge tone={role === 'owner' ? 'gold' : 'success'}>{role === 'owner' ? 'Owner' : 'Approver'}</Badge>;
}

/** Marks agent-generated content (transparency rule: every agent message carries it). */
export function AiBadge() {
  return (
    <Badge tone="neutral" icon={<span aria-hidden>✦</span>}>
      {/* Phones: "AI" keeps the agent's name and role readable beside it; screen readers hear the full label. */}
      <span aria-hidden className="sm:hidden">
        AI
      </span>
      <span className="sr-only sm:not-sr-only">AI-generated</span>
    </Badge>
  );
}

export function TranslatedBadge({ from }: { from: string }) {
  return (
    <Badge tone="glitch" icon={<span aria-hidden>文</span>}>
      Translated from {from}
    </Badge>
  );
}

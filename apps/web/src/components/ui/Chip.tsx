import type { AgentState } from '@crewarcade/shared';
import { BUSY_STATES, STATE_LABEL } from '@/lib/agents';
import { cn } from '@/lib/cn';

const STATE_TONE: Record<AgentState, string> = {
  idle: 'text-faint bg-surface-2',
  thinking: 'text-pixel bg-pixel/12',
  planning: 'text-pixel bg-pixel/12',
  building: 'text-forge bg-forge/12',
  testing: 'text-glitch bg-glitch/12',
  reproducing: 'text-glitch bg-glitch/12',
  waiting: 'text-gold bg-gold/12',
  blocked: 'text-danger bg-danger/12',
  error: 'text-danger bg-danger/12',
};

/** Agent state chip: "● Building v2". Busy states pulse. */
export function StateChip({ state, detail, className }: { state: AgentState; detail?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', STATE_TONE[state], className)} aria-live="polite">
      <span aria-hidden className={cn('size-1.5 rounded-full bg-current', BUSY_STATES.has(state) && 'animate-ping')} />
      {STATE_LABEL[state]}
      {detail && <span className="font-medium opacity-80">· {detail}</span>}
    </span>
  );
}

/** Selectable filter/option chip. */
export function Chip({ selected, onClick, children }: { selected?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors',
        selected ? 'border-brand bg-brand/15 text-brand' : 'border-border bg-surface text-dim hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

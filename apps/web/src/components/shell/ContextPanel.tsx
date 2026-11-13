import { AGENTS, type AgentKey } from '@crewarcade/shared';
import { Avatar, StateChip } from '@/components/ui';
import { ACCENT_TEXT } from '@/lib/agents';

/** Desktop right column. Phase 2+ fills it with the current game, its ledger and the leaderboard. */
export function ContextPanel() {
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
      <h2 className="font-display text-lg font-bold">Game panel</h2>
      <p className="text-sm text-dim">The game your crew is making shows up here: the plan, build progress, playtest GIFs and the leaderboard.</p>
      <ul className="flex flex-col gap-3">
        {(Object.keys(AGENTS) as AgentKey[]).map(k => (
          <li key={k} className="flex items-center gap-3 rounded-card border border-border bg-surface p-3">
            <Avatar kind="agent" agent={k} size="md" presence="online" />
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${ACCENT_TEXT[k]}`}>{AGENTS[k].displayName}</p>
              <StateChip state="idle" className="mt-1" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

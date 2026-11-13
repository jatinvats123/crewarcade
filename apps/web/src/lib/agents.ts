// UI mapping for agents and agent states (labels, accent classes). Data comes from @crewarcade/shared.
import { AGENTS, type AgentKey, type AgentState } from '@crewarcade/shared';

export const ACCENT_TEXT: Record<AgentKey, string> = { pixel: 'text-pixel', forge: 'text-forge', glitch: 'text-glitch' };
export const ACCENT_RING: Record<AgentKey, string> = { pixel: 'ring-pixel', forge: 'ring-forge', glitch: 'ring-glitch' };
export const ACCENT_BG: Record<AgentKey, string> = { pixel: 'bg-pixel', forge: 'bg-forge', glitch: 'bg-glitch' };

export const STATE_LABEL: Record<AgentState, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  planning: 'Planning',
  building: 'Building',
  testing: 'Playtesting',
  reproducing: 'Reproducing bug',
  waiting: 'Waiting for you',
  blocked: 'Blocked',
  error: 'Error',
};

/** States that show a moving indicator. */
export const BUSY_STATES: ReadonlySet<AgentState> = new Set(['thinking', 'planning', 'building', 'testing', 'reproducing']);

export const agentByKey = (key: AgentKey) => AGENTS[key];

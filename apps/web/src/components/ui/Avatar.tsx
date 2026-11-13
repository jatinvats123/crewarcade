/* eslint-disable @next/next/no-img-element -- agent avatars are tiny static SVGs */
import { AGENTS, type AgentKey, type AgentState } from '@crewarcade/shared';
import { ACCENT_RING, BUSY_STATES } from '@/lib/agents';
import { cn } from '@/lib/cn';

export type Presence = 'online' | 'away' | 'offline';
export type AvatarSize = 'sm' | 'md' | 'lg';

const SIZE: Record<AvatarSize, string> = { sm: 'size-8 text-base', md: 'size-10 text-xl', lg: 'size-14 text-3xl' };
const DOT: Record<AvatarSize, string> = { sm: 'size-2.5', md: 'size-3', lg: 'size-3.5' };
const PRESENCE: Record<Presence, string> = { online: 'bg-success', away: 'bg-warning', offline: 'bg-faint' };

/** Soft colour rings for human avatars (picked at signup). */
export const HUMAN_RINGS = {
  violet: 'ring-pixel/60 bg-pixel/15',
  amber: 'ring-forge/60 bg-forge/15',
  cyan: 'ring-glitch/60 bg-glitch/15',
  pink: 'ring-brand/60 bg-brand/15',
  green: 'ring-success/60 bg-success/15',
  gold: 'ring-gold/60 bg-gold/15',
} as const;
export type HumanColor = keyof typeof HUMAN_RINGS;

type Props =
  | { kind: 'human'; emoji: string; color: HumanColor; name: string; presence?: Presence; size?: AvatarSize; className?: string }
  | { kind: 'agent'; agent: AgentKey; state?: AgentState; presence?: Presence; size?: AvatarSize; className?: string };

export function Avatar(props: Props) {
  const size = props.size ?? 'md';
  const busy = props.kind === 'agent' && props.state && BUSY_STATES.has(props.state);
  const label = props.kind === 'agent' ? AGENTS[props.agent].displayName : props.name;
  return (
    <span className={cn('relative inline-flex shrink-0', props.className)} role="img" aria-label={label}>
      {props.kind === 'agent' ? (
        <span className={cn('inline-flex overflow-hidden rounded-full ring-2', ACCENT_RING[props.agent], SIZE[size], busy && 'animate-pulse')}>
          <img src={AGENTS[props.agent].avatarPath} alt="" width={56} height={56} className="size-full" />
        </span>
      ) : (
        <span className={cn('inline-flex items-center justify-center rounded-full ring-2', HUMAN_RINGS[props.color], SIZE[size])} aria-hidden>
          {props.emoji}
        </span>
      )}
      {props.presence && (
        <span className={cn('absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-bg', DOT[size], PRESENCE[props.presence])} aria-label={props.presence} />
      )}
    </span>
  );
}

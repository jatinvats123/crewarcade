import { AGENTS, type AgentKey, type AgentState } from '@crewarcade/shared';
import { Avatar, HUMAN_RINGS, type HumanColor, type Presence } from '@/components/ui';

/** "agent-pixel" / "agentpixel" -> "pixel"; humans -> null. */
export function agentKeyOf(id: string): AgentKey | null {
  for (const a of Object.values(AGENTS)) if (a.id === id || a.id.replace('-', '') === id) return a.key;
  return null;
}

export const humanColor = (c: string): HumanColor => (c in HUMAN_RINGS ? (c as HumanColor) : 'violet');

export interface AvatarPerson {
  id: string;
  displayName: string;
  avatarEmoji: string;
  avatarColor: string;
}

export function MemberAvatar({
  person,
  presence,
  size = 'md',
  agentState,
  className,
}: {
  person: AvatarPerson;
  presence?: Presence;
  size?: 'sm' | 'md' | 'lg';
  agentState?: AgentState;
  className?: string;
}) {
  const agent = agentKeyOf(person.id);
  if (agent)
    return (
      <Avatar
        kind="agent"
        agent={agent}
        size={size}
        {...(presence && { presence })}
        {...(agentState && { state: agentState })}
        {...(className && { className })}
      />
    );
  return (
    <Avatar
      kind="human"
      emoji={person.avatarEmoji}
      color={humanColor(person.avatarColor)}
      name={person.displayName}
      size={size}
      {...(presence && { presence })}
      {...(className && { className })}
    />
  );
}

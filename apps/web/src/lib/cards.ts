// Pure helpers for card UIs: optimistic votes and status text. Unit-tested.
import { applyVote, parseCardMeta, type PlanCardMeta } from '@crewarcade/shared';

/** The metadata a plan card shows right after I tap a vote, before the server answers. */
export function optimisticVote(meta: Record<string, string> | undefined, myId: string, vote: 'yes' | 'no'): Record<string, string> {
  const current = parseCardMeta('plan', meta);
  const next = applyVote(current.voters, myId, vote);
  return { ...meta, yes: String(next.yes), no: String(next.no), voters: JSON.stringify(next.voters) };
}

export function planStatusLabel(m: PlanCardMeta): { text: string; tone: 'neutral' | 'success' | 'gold' | 'danger' } {
  switch (m.status) {
    case 'approved':
      return { text: m.approvedBy ? `Approved by ${m.approvedBy}` : 'Approved', tone: 'success' };
    case 'changes_requested':
      return { text: 'Change requested · Pixel is revising', tone: 'gold' };
    case 'superseded':
      return { text: 'Replaced by a newer plan', tone: 'neutral' };
    default:
      return { text: 'Voting · an approver decides', tone: 'gold' };
  }
}

/** "32s", "1:05" for agent timers. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

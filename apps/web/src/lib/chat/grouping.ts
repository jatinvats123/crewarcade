// Timeline layout: day separators, and consecutive messages from one sender (within 5 minutes)
// grouped under one name/avatar. Pure and tested.
import type { ChatMessage } from './types';

export const GROUP_GAP_MS = 5 * 60 * 1000;

export interface SenderGroup {
  key: string;
  senderId: string;
  direction: 'in' | 'out';
  messages: ChatMessage[];
}
export interface DayBlock {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  items: Array<{ type: 'group'; group: SenderGroup } | { type: 'notice'; message: ChatMessage }>;
}

export const localDay = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function groupTimeline(messages: ChatMessage[]): DayBlock[] {
  const days: DayBlock[] = [];
  for (const m of messages) {
    const day = localDay(m.sentTime);
    let block = days[days.length - 1];
    if (!block || block.day !== day) {
      block = { day, items: [] };
      days.push(block);
    }
    if (m.kind === 'notice') {
      block.items.push({ type: 'notice', message: m });
      continue;
    }
    const last = block.items[block.items.length - 1];
    const prev = last?.type === 'group' ? last.group.messages[last.group.messages.length - 1] : undefined;
    if (last?.type === 'group' && last.group.senderId === m.senderId && prev && m.sentTime - prev.sentTime <= GROUP_GAP_MS) last.group.messages.push(m);
    else block.items.push({ type: 'group', group: { key: m.key, senderId: m.senderId, direction: m.direction, messages: [m] } });
  }
  return days;
}

/** "Today", "Yesterday", weekday within a week, else a short date. */
export function dayLabel(day: string, now = Date.now()): string {
  const today = localDay(now);
  const yesterday = localDay(now - 86_400_000);
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(y, mo - 1, d);
  if (now - date.getTime() < 6 * 86_400_000) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(date.getFullYear() !== new Date(now).getFullYear() && { year: 'numeric' }) });
}

export const clockTime = (t: number): string => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// The room on screen (crew chat or a game room), shared with the desktop context panel.
import type { GameSummary } from '@crewarcade/shared';
import { useSyncExternalStore } from 'react';
import { createStore } from './chat/store';
import type { ChatMessage } from './chat/types';

export interface ActiveRoom {
  crewId: string;
  channelId: string;
  game: GameSummary | null;
}

type Action = { type: 'set'; room: ActiveRoom | null };
export const activeRoomStore = createStore<ActiveRoom | null, Action>(null, (s, a) =>
  a.room === null ? null : s && s.channelId === a.room.channelId && s.game?.id === a.room.game?.id && s.game?.status === a.room.game?.status ? s : a.room,
);

export function useActiveRoom(): ActiveRoom | null {
  return useSyncExternalStore(activeRoomStore.subscribe, activeRoomStore.getState, () => null);
}

export const roomHref = (crewId: string, channelId: string, crewChannelId: string): string =>
  channelId === crewChannelId ? `/crews/${crewId}` : `/crews/${crewId}/rooms/${channelId}`;

/**
 * What changes when the game's status may have changed (pure; tested): a card arriving or changing
 * state (build ready, test done, publish decided), or an agent posting. The room refreshes its game
 * when this changes, so the side panel's status chip follows along live.
 */
export function roomActivitySignature(messages: readonly Pick<ChatMessage, 'kind' | 'messageId' | 'senderId' | 'meta' | 'card'>[]): string {
  let agentPosts = 0;
  const cards: string[] = [];
  for (const m of messages) {
    if (m.kind === 'card' && m.card) cards.push(`${m.card.kind}:${m.messageId ?? ''}:${m.meta?.status ?? ''}:${m.meta?.next ?? ''}`);
    else if (m.senderId.startsWith('agent')) agentPosts++;
  }
  return `${cards.join('|')}#${agentPosts}`;
}

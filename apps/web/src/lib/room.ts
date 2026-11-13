// The room on screen (crew chat or a game room), shared with the desktop context panel.
import type { GameSummary } from '@crewarcade/shared';
import { useSyncExternalStore } from 'react';
import { createStore } from './chat/store';

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

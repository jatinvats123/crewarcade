// Tiny external stores (useSyncExternalStore) for the chat state and presence, so a new message
// re-renders only the components that read the affected channel.
import { useSyncExternalStore } from 'react';
import { chatReducer, type ChatAction } from './reducer';
import { initialChatState, type ChannelState, type ChatState } from './types';

export interface Store<S, A> {
  getState: () => S;
  dispatch: (a: A) => void;
  subscribe: (l: () => void) => () => void;
}

export function createStore<S, A>(initial: S, reduce: (s: S, a: A) => S): Store<S, A> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch: a => {
      const next = reduce(state, a);
      if (next === state) return;
      state = next;
      for (const l of listeners) l();
    },
    subscribe: l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export type ChatStore = Store<ChatState, ChatAction>;
export const createChatStore = (): ChatStore => createStore(initialChatState, chatReducer);

export function useChannelState(store: ChatStore, channelId: string | null): ChannelState | undefined {
  return useSyncExternalStore(
    store.subscribe,
    () => (channelId ? store.getState().channels[channelId] : undefined),
    () => undefined,
  );
}

export function useAllChannels(store: ChatStore): ChatState['channels'] {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().channels,
    () => initialChatState.channels,
  );
}

// ---- presence: nexconn user id -> online

export type PresenceAction = { type: 'set'; entries: Array<[string, boolean]> };
export type PresenceStore = Store<Record<string, boolean>, PresenceAction>;
export const createPresenceStore = (): PresenceStore =>
  createStore<Record<string, boolean>, PresenceAction>({}, (s, a) => {
    let changed = false;
    const next = { ...s };
    for (const [id, online] of a.entries)
      if (next[id] !== online) {
        next[id] = online;
        changed = true;
      }
    return changed ? next : s;
  });

export function usePresence(store: PresenceStore): Record<string, boolean> {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState(),
    () => ({}),
  );
}

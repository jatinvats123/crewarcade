'use client';

// What a card needs from its surroundings: who is viewing, room links, the card actions (our API)
// and a way to update a card's metadata locally (optimistic votes). Cards never talk to Nexconn or
// the API directly, so they also render in the /dev/ui gallery. The role here only hides buttons a
// person cannot use; the server decides every action.
import type { CardActionResponse } from '@crewarcade/shared';
import { createContext, useContext } from 'react';

export interface CardActions {
  vote: (messageId: string, vote: 'yes' | 'no') => Promise<CardActionResponse>;
  approve: (messageId: string) => Promise<CardActionResponse>;
  requestChange: (messageId: string, text: string) => Promise<CardActionResponse>;
}

export interface CardEnv {
  crewId: string;
  /** Nexconn id of the viewer (the key in a plan's voters map). */
  myId: string;
  /** Owner or approver of this crew. */
  canApprove: boolean;
  /** Link to a room of this crew. */
  roomHref: (channelId: string) => string;
  actions: CardActions;
  /** Merge (or replace) a card's metadata in the local timeline. */
  setMeta: (channelId: string, messageId: string, metadata: Record<string, string>, replace?: boolean) => void;
}

const CardEnvContext = createContext<CardEnv | null>(null);
export const CardEnvProvider = CardEnvContext.Provider;

export function useCardEnv(): CardEnv {
  const env = useContext(CardEnvContext);
  if (!env) throw new Error('cards need <CardEnvProvider>');
  return env;
}

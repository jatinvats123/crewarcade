// Client-side chat model. SDK message objects are normalized into these plain values at the edge
// (normalize.ts), so the reducer and the UI never touch SDK classes.

import type { AgentStateMessage, AnyCard } from '@crewarcade/shared';

export type MessageKind = 'text' | 'image' | 'voice' | 'notice' | 'card' | 'stream' | 'unknown';
export type SendStatus = 'sending' | 'sent' | 'failed';

export interface ChatMessage {
  /** Stable React key: the Nexconn messageId once known, else "local:<localId>". */
  key: string;
  messageId: string | null;
  /** Set for messages sent from this device (optimistic sends). */
  localId: string | null;
  channelId: string;
  /** Nexconn user id of the sender. */
  senderId: string;
  /** Server time (ms) when known; local time for optimistic sends. */
  sentTime: number;
  kind: MessageKind;
  /** The Nexconn messageType (RC:TxtMsg, CA:Card...). */
  rawType: string;
  text?: string;
  mentionedUserIds?: string[];
  mentionAll?: boolean;
  image?: { url: string; thumb: string | null };
  voice?: { url: string; durationS: number };
  notice?: { kind: string; text: string };
  /** CA:*Card messages: the decoded card (null when the content is invalid or from a newer version). */
  card?: AnyCard | null;
  /** Nexconn message metadata (live card state: votes, status...). */
  meta?: Record<string, string>;
  /** RC:StreamMsg: false while chunks are still arriving. */
  streamComplete?: boolean;
  direction: 'out' | 'in';
  status: SendStatus;
  /** 0-100 while a media upload runs. */
  progress?: number;
  /** Error code of the last failed send. */
  errorCode?: number;
  /** Read receipts (group): how many members have read it, out of how many. */
  readCount?: number;
  totalCount?: number;
  /** Incoming: the sender asked for a receipt / we already sent it. */
  needReceipt: boolean;
  receiptSent: boolean;
  /** Set when the pre-messaging shield blocked it: the `extra` text from our server. */
  blockedReason?: string;
}

export interface ChannelState {
  messages: ChatMessage[];
  /** History pagination. */
  hasMore: boolean;
  loaded: boolean;
  /** Nexconn user id -> time (ms) the typing indicator expires. */
  typing: Record<string, number>;
  unread: number;
  /** Last message for the crew list when the timeline is not loaded (from the channel list). */
  preview: ChatMessage | null;
  /** Live agent states (CA:AgentState) by agent key, with the local time they arrived. */
  agentStates: Record<string, AgentStateMessage & { receivedAt: number }>;
}

export interface ChatState {
  channels: Record<string, ChannelState>;
}

export const emptyChannel = (): ChannelState => ({ messages: [], hasMore: true, loaded: false, typing: {}, unread: 0, preview: null, agentStates: {} });
export const initialChatState: ChatState = { channels: {} };

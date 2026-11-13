// Non-sequential IDs. Nexconn user and channel IDs allow letters and digits only (<= 64 bytes),
// so every ID we mint uses an alphanumeric nanoid alphabet. Prefixes make logs readable.
import { customAlphabet } from 'nanoid';

export const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const nano16 = customAlphabet(ID_ALPHABET, 16);
const inviteNano = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 8); // no 0/O/1/I: easy to read aloud

export const ID_PREFIX = {
  user: 'u',
  crew: 'c',
  game: 'g',
  version: 'v',
  bug: 'b',
  score: 's',
  ledger: 'l',
  moderation: 'm',
  /** Nexconn group channel for a crew's main chat. */
  crewChannel: 'crew',
  /** Nexconn group channel for one game's room. */
  gameChannel: 'game',
  /** Nexconn open channel for a Live Build Theater. */
  liveChannel: 'live',
} as const;
export type IdKind = keyof typeof ID_PREFIX;

/** e.g. newId('crew') -> "c4fK9xQ2LmN8pR3tV" (prefix + 16 alphanumerics). */
export const newId = (kind: IdKind): string => `${ID_PREFIX[kind]}${nano16()}`;

/** Short crew invite code, e.g. "K7XQ2MPA". */
export const newInviteCode = (): string => inviteNano();

/** Letters and digits only, 1-64 chars: what Nexconn accepts for user and channel IDs. */
export const NEXCONN_ID_RE = /^[A-Za-z0-9]{1,64}$/;
export const isNexconnId = (s: string): boolean => NEXCONN_ID_RE.test(s);

/**
 * The Nexconn user ID for one of our user IDs. Human IDs are already alphanumeric; the agent IDs
 * fixed by the spec ("agent-pixel") contain "-", which the Nexconn docs do not allow, so the
 * boundary strips it ("agentpixel"). Always go through this function when talking to Nexconn.
 */
export function nexconnUserId(userId: string): string {
  const id = userId.replace(/[^A-Za-z0-9]/g, '');
  if (!isNexconnId(id)) throw new Error(`Cannot map "${userId}" to a Nexconn user ID`);
  return id;
}

// Which postMessages the player trusts. The game runs in an iframe with sandbox="allow-scripts"
// (never allow-same-origin), so its origin is the opaque "null"; what identifies it is the event
// source being OUR iframe's window. Anything else (other frames, extensions, the page itself, or
// shapes other than the two score-hook messages) is ignored. The score is still only a claim: the
// server applies plausibility limits before it reaches a leaderboard.
import { parseGameHostMessage, type GameHostMessage } from '@crewarcade/shared';

export interface HostMessageEvent {
  source: unknown;
  origin: string;
  data: unknown;
}

/**
 * @param frame   the iframe's contentWindow
 * @param gameOrigin the origin the game is served from (accepted too, should a browser report it)
 */
export function acceptHostMessage(e: HostMessageEvent, frame: unknown, gameOrigin: string | null): GameHostMessage | null {
  if (!frame || e.source !== frame) return null;
  if (e.origin !== 'null' && e.origin !== gameOrigin) return null;
  return parseGameHostMessage(e.data);
}

/** The iframe attributes live in @crewarcade/shared (the server's hostile-game test uses them too). */
export { GAME_ALLOW, GAME_SANDBOX } from '@crewarcade/shared';

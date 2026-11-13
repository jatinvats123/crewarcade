// Message router: decides whether a chat message is work for an agent, and which. Pure: the webhook
// processor feeds it the parsed message and room facts, and enqueues a job for the result.
// Rules (docs/SPEC.md §3, Phase 2):
//  - agents never trigger agents (the caller drops messages from agent users first);
//  - an agent is addressed by a structured mention, "@pixel" / "@forge" / "@glitch" in the text
//    (any case), or its Hindi name ("@पिक्सेल", or the name opening the message: "पिक्सेल, ...");
//  - commands: "remix <game> into <idea>", "explain ...", "bug: ...", "make it ...", "pitch: ...";
//  - in a solo crew (one human) a plain pitch in the crew chat needs no mention.
import type { AgentKey } from '@crewarcade/shared';

export type IntentKind = 'plan' | 'change' | 'explain' | 'remix' | 'bug' | 'chat';

export interface Intent {
  agent: AgentKey;
  kind: IntentKind;
  /** The message with the agent mention removed (the pitch, the question, the change...). */
  text: string;
  remix?: { source: string; idea: string };
}

export interface RouteInput {
  text: string;
  /** Nexconn user ids from the message's mentionedInfo. */
  mentionedUserIds: readonly string[];
  roomKind: 'crew' | 'game';
  /** Humans in the crew (agents excluded). */
  humanCount: number;
}

const AGENT_KEYS: readonly AgentKey[] = ['pixel', 'forge', 'glitch'];
const NEXCONN_AGENT: Record<string, AgentKey> = { agentpixel: 'pixel', agentforge: 'forge', agentglitch: 'glitch' };

/** Names people type, per agent: Latin (any case) and Devanagari spellings. */
const NAMES: Record<AgentKey, string[]> = {
  pixel: ['pixel', 'पिक्सेल', 'पिक्सल', 'पिक्सेल्', 'पिक्सैल'],
  forge: ['forge', 'फोर्ज', 'फ़ोर्ज', 'फोर्ज़'],
  glitch: ['glitch', 'ग्लिच', 'ग्लिच्'],
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "@name" anywhere (not part of a longer word or an email), or the bare name opening the message
// followed by a comma, colon or a Hinglish address word ("pixel bhai", "pixel ji").
const AT_RE = new RegExp(`(^|[^\\p{L}\\p{N}_@.])@(${Object.values(NAMES).flat().map(esc).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
// `\b` is ASCII-only, so word ends use a lookahead (Devanagari words end in combining marks).
const END = '(?=$|[\\s,.:;!?])';
const LEAD_RE = new RegExp(`^\\s*(${Object.values(NAMES).flat().map(esc).join('|')})\\s*(?:[,:،-]|\\s+(?:bhai|ji|yaar|bro|भाई|जी)${END}[,:]?)`, 'iu');

const keyForName = (name: string): AgentKey | null => {
  const n = name.toLowerCase();
  for (const k of AGENT_KEYS) if (NAMES[k].some(x => x.toLowerCase() === n)) return k;
  return null;
};

/** Agents addressed in the message, in order of first appearance, and the text without the mentions. */
export function findMentions(text: string, mentionedUserIds: readonly string[]): { agents: AgentKey[]; rest: string } {
  const found: AgentKey[] = [];
  const add = (k: AgentKey | null) => {
    if (k && !found.includes(k)) found.push(k);
  };
  let rest = text;
  const lead = LEAD_RE.exec(rest);
  if (lead) {
    add(keyForName(lead[1]!));
    rest = rest.slice(lead[0].length);
  }
  rest = rest.replace(AT_RE, (_m, pre: string, name: string) => {
    add(keyForName(name));
    return pre;
  });
  for (const id of mentionedUserIds) add(NEXCONN_AGENT[id] ?? null);
  return {
    agents: found,
    rest: rest
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[,:\s-]+/, ''),
  };
}

const REMIX_RES: RegExp[] = [
  /^remix\s+["“']?(.+?)["”']?\s+(?:into|as|to)\s+(.+)$/i,
  /^["“']?(.+?)["”']?\s+ko\s+(.+?)\s+(?:mein|me|main)\s+remix\s+(?:karo|kar do|kardo|kar)\b.*$/i,
  /^["“']?(.+?)["”']?\s+को\s+(.+?)\s+में\s+रीमिक्स\s+(?:करो|कर दो).*$/u,
];
const EXPLAIN_RE = new RegExp(
  `^(?:explain|why|how\\s+(?:does|do|is|did|can)|what\\s+(?:does|is|happens)|samjhao|samjha\\s+do|समझाओ|समझा\\s+दो|बताओ)${END}|kaise\\s+kaam\\s+karta|कैसे\\s+काम\\s+करता`,
  'iu',
);
const BUG_RE = /^(?:bug|बग)\s*[:\-–]\s*(.+)$/isu;
const CHANGE_RE = new RegExp(`^(?:make\\s+(?:it|the)|change\\s+(?:it|the)|add|remove|less|more|faster|slower|isko|ise|isse|इसे|इसको)${END}`, 'iu');
const PITCH_RE = /^(?:pitch|idea|game)\s*[:\-–]\s*(.+)$/isu;
const GREETING_RE = /^(?:hi|hey|hello|yo|hii+|namaste|namaskar|नमस्ते|thanks|thank you|thx|ok|okay|cool|nice|lol|haha|👍|🙏|❤️)[\s!.?]*$/iu;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Command found in text, independent of who was mentioned. */
function command(text: string): Omit<Intent, 'agent'> & { agent?: AgentKey } {
  for (const re of REMIX_RES) {
    const m = re.exec(text);
    if (m) return { kind: 'remix', agent: 'pixel', text, remix: { source: m[1]!.trim(), idea: m[2]!.trim() } };
  }
  const bug = BUG_RE.exec(text);
  if (bug) return { kind: 'bug', agent: 'glitch', text: bug[1]!.trim() };
  const pitch = PITCH_RE.exec(text);
  if (pitch) return { kind: 'plan', agent: 'pixel', text: pitch[1]!.trim() };
  if (EXPLAIN_RE.test(text)) return { kind: 'explain', text };
  if (CHANGE_RE.test(text)) return { kind: 'change', agent: 'pixel', text };
  return { kind: 'chat', text };
}

export function routeMessage(input: RouteInput): Intent | null {
  const raw = input.text.trim();
  if (!raw) return null;
  const { agents, rest } = findMentions(raw, input.mentionedUserIds);
  const cmd = command(rest);
  const solo = input.humanCount <= 1;

  if (agents.length > 0) {
    const addressed = agents[0]!;
    // Bug reports always go to Glitch; remixes and plan changes are Pixel's, whoever was tagged.
    if (cmd.kind === 'bug' || cmd.kind === 'remix') return { ...cmd, agent: cmd.agent! };
    if (cmd.kind === 'change') return { kind: 'change', agent: addressed === 'pixel' ? 'pixel' : addressed, text: cmd.text };
    if (cmd.kind === 'explain') return { kind: 'explain', agent: addressed, text: cmd.text };
    if (cmd.kind === 'plan') return { kind: 'plan', agent: 'pixel', text: cmd.text };
    // A bare mention: Pixel treats a real sentence as a pitch; everything else is a chat line.
    if (addressed === 'pixel' && input.roomKind === 'crew' && words(rest) >= 3 && !GREETING_RE.test(rest) && !rest.endsWith('?'))
      return { kind: 'plan', agent: 'pixel', text: rest };
    return { kind: 'chat', agent: addressed, text: rest };
  }

  // No mention: only unambiguous commands, plus pitches in a solo crew's chat.
  if (cmd.kind === 'bug' || cmd.kind === 'remix' || cmd.kind === 'plan') return { ...cmd, agent: cmd.agent! };
  if (!solo) return null;
  if (cmd.kind === 'change') return { kind: 'change', agent: 'pixel', text: cmd.text };
  if (input.roomKind === 'game') return cmd.kind === 'explain' ? { kind: 'explain', agent: 'pixel', text: cmd.text } : null;
  if (cmd.kind === 'explain' || GREETING_RE.test(rest) || rest.endsWith('?') || words(rest) < 3) return null;
  return { kind: 'plan', agent: 'pixel', text: rest };
}

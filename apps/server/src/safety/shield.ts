// The safety shield's rules: cheap, deterministic checks on a chat message (no AI, no I/O), shared
// by both modes:
//   - pre-delivery: Nexconn's *:pre_messaging webhook (the message never reaches the room), when
//     pre-messaging is enabled for the App Key;
//   - after-delivery: on message:send, the message is deleted for everyone within about a second
//     (POST /v4/message/delete) and a 🛡 notice explains why.
// Role checks on every API action stay server-enforced elsewhere; this only keeps the chat clean
// and stops people from talking agents into things. Pure functions; every rule is tested.

export const SHIELD_RULES = ['prompt_injection', 'unauthorized_command', 'abuse', 'spam'] as const;
export type ShieldRule = (typeof SHIELD_RULES)[number];

export interface ShieldHit {
  rule: ShieldRule;
  /** What the room sees in the 🛡 notice (no quote of the removed text). */
  notice: string;
  /** Short excerpt for the moderation log, with abusive words masked. */
  excerpt: string;
}

/** What each rule does, for the /safety page (public). */
export const RULE_INFO: Record<ShieldRule, { label: string; what: string }> = {
  prompt_injection: {
    label: 'Prompt injection',
    what: 'Messages that try to change how the agents work ("ignore your instructions", "reveal your system prompt"), in English, Hindi and Hinglish.',
  },
  unauthorized_command: {
    label: 'Ship command from a non-approver',
    what: 'Only approvers can publish. A member telling the agents to ship, publish or go live is removed (the Allow button is role-checked on the server too).',
  },
  abuse: { label: 'Abuse', what: 'Slurs and abusive words in English, Hindi and Hinglish.' },
  spam: { label: 'Spam', what: 'Link floods, the same message again and again, or a burst of messages in a few seconds.' },
};

const NOTICES: Record<ShieldRule, string> = {
  prompt_injection: '🛡 Glitch removed a message that tried to change how the agents work. The agents keep their rules.',
  unauthorized_command: '🛡 Glitch removed a message asking the agents to ship. Only approvers can publish, with the Allow button.',
  abuse: '🛡 Glitch removed a message with abusive language. Keep it friendly!',
  spam: '🛡 Glitch removed a message that looked like spam.',
};

// ---- prompt injection --------------------------------------------------------------------------

const INJECTION: RegExp[] = [
  // English
  /\b(ignore|disregard|forget|override|bypass|skip)\b[^.\n]{0,30}\b(previous|prior|above|earlier|all|your|the|system|safety)\b[^.\n]{0,20}\b(instructions?|rules?|prompts?|directions?|guidelines?|guardrails?)\b/i,
  /\b(system|developer|hidden|initial)\s+(prompt|message|instructions?)\b/i,
  /\b(reveal|show|print|repeat|leak|tell me)\b[^.\n]{0,25}\b(your|the)\s+(prompt|instructions?|rules|api[\s_-]?keys?|secrets?|tokens?)\b/i,
  /\byou\s+are\s+now\s+(a|an|in|my|the|no longer)\b/i,
  /\b(developer|god|admin|sudo|debug)\s+mode\b/i,
  /\bjail\s?break\b|\bDAN\s+mode\b|\bdo anything now\b/i,
  /\bnew\s+(instructions?|rules?)\s*:/i,
  /\bpretend\s+(you\s+are|to\s+be|you're)\s+(not\s+)?(an?\s+|the\s+|my\s+)?(ai|assistant|admin|developer|system|approver|owner)\b/i,
  /<\/?\s*(untrusted|system|instructions?)\b[^>]*>/i,
  // Hinglish (romanised Hindi)
  /\b(pichl[eai]|purane|saare|sare|sab|apne|apni)\b[^.\n]{0,20}\b(instructions?|rules?|nirdesh|niyam|prompt)\b[^.\n]{0,20}\b(bhool|bhul|ignore|chhod|chod|tod|hata)/i,
  /\b(instructions?|rules?|nirdesh|niyam|prompt)\b[^.\n]{0,12}\b(bhool|bhul|ignore|chhod|chod|tod)\s*(jao|ja|do|de|karo|kar\s*do|dena)\b/i,
  /\b(system\s+prompt|prompt|instructions?|api\s*key)\b[^.\n]{0,15}\b(batao|bata\s*do|dikhao|dikha\s*do|bolo|likho)\b/i,
  /\bab\s+(tum|tu|aap)\b[^.\n]{0,25}\b(admin|developer|approver|owner|bina\s+rules?)\b/i,
  // Hindi (Devanagari)
  /(निर्देश|निर्देशों|नियम|नियमों)[^।\n]{0,15}(भूल|अनदेखा|नज़रअंदाज़|नजरअंदाज|तोड़|छोड़)/u,
  /(सिस्टम\s*प्रॉम्प्ट|सिस्टम\s*प्रोम्प्ट)/u,
];

// ---- ship commands -----------------------------------------------------------------------------

const AGENT_ADDRESS = /(^|[\s,.!?])@?(pixel|forge|glitch|agents?|bots?)\b/i;
const SHIP_VERB =
  /\b(publish|ship\s+it|ship|deploy|release|go\s+live|make\s+it\s+(public|live)|allow\s+(it|publish|the\s+game)|approve\s+(it|the\s+publish|publishing))\b|\b(publish|live|public)\s+kar(\s*do|o|\s*de)?\b|(पब्लिश|लाइव)\s*कर/iu;

/** A message telling the agents to ship/publish (only approvers may; checked by the caller). */
export function isShipCommand(text: string): boolean {
  return AGENT_ADDRESS.test(text) && SHIP_VERB.test(text);
}

// ---- abuse -------------------------------------------------------------------------------------

const ABUSE_WORDS = [
  // English
  'fuck',
  'fucking',
  'fucker',
  'motherfucker',
  'bitch',
  'bastard',
  'cunt',
  'slut',
  'whore',
  'retard',
  'asshole',
  // Hinglish
  'madarchod',
  'madarchodd',
  'behenchod',
  'bhenchod',
  'benchod',
  'chutiya',
  'chutiye',
  'chutiyapa',
  'bhosdike',
  'bhosdi',
  'bhosadi',
  'bsdk',
  'gandu',
  'gaandu',
  'randi',
  'harami',
  'lavda',
  'lauda',
  'lund',
  'mc',
  'bc',
];
// "bc" and "mc" are also English texting ("because", "MC"); only counted next to another abuse word.
const WEAK = new Set(['bc', 'mc']);
const ABUSE_DEVANAGARI = ['मादरचोद', 'बहनचोद', 'भेनचोद', 'चूतिया', 'चुतिया', 'भोसड़ी', 'भोसडी', 'रंडी', 'गांडू', 'हरामी', 'लौड़ा'];
const ABUSE_RE = new RegExp(`\\b(${ABUSE_WORDS.join('|')})\\b`, 'gi');

/** Abusive words in a text (romanised + Devanagari), lowercased. */
export function abuseWords(text: string): string[] {
  const latin = [...text.matchAll(ABUSE_RE)].map(m => m[1]!.toLowerCase());
  const strong = latin.filter(w => !WEAK.has(w));
  const deva = ABUSE_DEVANAGARI.filter(w => text.includes(w));
  return strong.length || deva.length ? [...latin, ...deva] : [];
}

/** Masks abusive words (first letter + stars) so logs never store them in full. */
export function maskAbuse(text: string): string {
  let out = text.replace(ABUSE_RE, w => (WEAK.has(w.toLowerCase()) ? w : `${w[0]}${'*'.repeat(Math.max(2, w.length - 1))}`));
  for (const w of ABUSE_DEVANAGARI) out = out.split(w).join(`${[...w][0]}***`);
  return out;
}

// ---- spam --------------------------------------------------------------------------------------

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

/** Content-only spam signs (no history needed). */
export function isSpamContent(text: string): boolean {
  if ((text.match(URL_RE) ?? []).length >= 3) return true;
  if (/(.)\1{29,}/su.test(text)) return true; // 30+ of the same character
  return false;
}

/**
 * Per-user flood tracker (in memory; one server process): the same text (8+ chars: "lol" and "hi"
 * don't count) 3 times within 60 s, or 8 messages within 10 s. A message id is counted once, so the
 * pre- and after-delivery checks of one message don't add up. The clock is injected for tests.
 */
export function createFloodTracker(now: () => number, o: { repeat?: number; repeatWindowMs?: number; burst?: number; burstWindowMs?: number } = {}) {
  const repeat = o.repeat ?? 3;
  const repeatWindow = o.repeatWindowMs ?? 60_000;
  const burst = o.burst ?? 8;
  const burstWindow = o.burstWindowMs ?? 10_000;
  const seen = new Map<string, Array<{ t: number; text: string }>>();
  const counted = new Map<string, boolean>();
  return {
    /** Records the message and says whether it floods. */
    hit(userId: string, channelId: string, text: string, messageId?: string): boolean {
      const t = now();
      if (messageId) {
        if (counted.has(messageId)) return counted.get(messageId)!;
        if (counted.size > 5000) counted.delete(counted.keys().next().value!);
      }
      const key = `${userId}|${channelId}`;
      const norm = text.trim().toLowerCase().replace(/\s+/g, ' ');
      const list = (seen.get(key) ?? []).filter(e => t - e.t < Math.max(repeatWindow, burstWindow));
      list.push({ t, text: norm });
      seen.set(key, list.slice(-50));
      if (seen.size > 5000) seen.delete(seen.keys().next().value!);
      const same = norm.length >= 8 ? list.filter(e => t - e.t < repeatWindow && e.text === norm).length : 0;
      const recent = list.filter(e => t - e.t < burstWindow).length;
      const flood = same >= repeat || recent >= burst;
      if (messageId) counted.set(messageId, flood);
      return flood;
    },
  };
}

// ---- the check ---------------------------------------------------------------------------------

function excerptOf(text: string): string {
  const flat = maskAbuse(text.replace(/\s+/g, ' ').trim());
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
}

const hit = (rule: ShieldRule, text: string): ShieldHit => ({ rule, notice: NOTICES[rule], excerpt: excerptOf(text) });

/**
 * Checks one text message. `canApprove` is the sender's right to publish in this crew (owner or
 * approver); `flooding` comes from the flood tracker. Order: injection, abuse, spam, ship command.
 */
export function checkMessage(text: string, o: { canApprove: boolean; flooding?: boolean }): ShieldHit | null {
  const t = text.normalize('NFKC');
  if (!t.trim()) return null;
  if (INJECTION.some(re => re.test(t))) return hit('prompt_injection', t);
  if (abuseWords(t).length) return hit('abuse', t);
  if (o.flooding || isSpamContent(t)) return hit('spam', t);
  if (!o.canApprove && isShipCommand(t)) return hit('unauthorized_command', t);
  return null;
}

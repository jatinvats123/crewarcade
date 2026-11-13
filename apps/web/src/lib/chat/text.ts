// Message text: linkify, @mention highlighting, mention resolution and the composer's @-query.
// Pure and tested. Links are only http(s); mentions match a member's handle as a whole word.

export interface MentionTarget {
  /** Nexconn user id. */
  userId: string;
  /** What follows "@": agents use their short handle (pixel), humans their display name. */
  handle: string;
  label: string;
  isAgent: boolean;
}

export type Segment = { type: 'text'; value: string } | { type: 'link'; value: string; href: string } | { type: 'mention'; value: string; userId: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "@handle" as a whole token: start or whitespace before, end/space/punctuation after. */
const mentionRe = (handle: string) => new RegExp(`(^|\\s)@${escapeRe(handle)}(?=$|[\\s.,!?:;)])`, 'giu');

/** Members whose @handle appears in the text (what we send as mentionedInfo.userIdList). */
export function resolveMentions(text: string, targets: MentionTarget[]): string[] {
  const ids = new Set<string>();
  for (const t of targets) if (t.handle && mentionRe(t.handle).test(text)) ids.add(t.userId);
  return [...ids];
}

/** Splits text into plain text, links and mentions (for rendering). */
export function tokenize(text: string, targets: MentionTarget[] = []): Segment[] {
  type Hit = { start: number; end: number; seg: Segment };
  const hits: Hit[] = [];
  for (const m of text.matchAll(URL_RE)) hits.push({ start: m.index, end: m.index + m[0].length, seg: { type: 'link', value: m[0], href: m[0] } });
  // Longest handles first so "@Sam K" wins over "@Sam".
  for (const t of [...targets].sort((a, b) => b.handle.length - a.handle.length)) {
    if (!t.handle) continue;
    for (const m of text.matchAll(mentionRe(t.handle))) {
      const start = m.index + m[1]!.length;
      const end = start + 1 + t.handle.length;
      if (!hits.some(h => start < h.end && end > h.start)) hits.push({ start, end, seg: { type: 'mention', value: text.slice(start, end), userId: t.userId } });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let pos = 0;
  for (const h of hits) {
    if (h.start > pos) out.push({ type: 'text', value: text.slice(pos, h.start) });
    out.push(h.seg);
    pos = h.end;
  }
  if (pos < text.length) out.push({ type: 'text', value: text.slice(pos) });
  return out;
}

/** The "@que" being typed right before the caret, or null. */
export function mentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([\p{L}\p{M}\p{N}_.'-]{0,24})$/u.exec(before);
  if (!m) return null;
  return { query: m[2]!, start: before.length - m[2]!.length - 1 };
}

/** Candidates for the autocomplete: agents first, then people; prefix matches before substring matches. */
export function mentionCandidates(query: string, targets: MentionTarget[], limit = 6): MentionTarget[] {
  const q = query.toLocaleLowerCase();
  const score = (t: MentionTarget) => {
    const h = t.handle.toLocaleLowerCase();
    const l = t.label.toLocaleLowerCase();
    if (h.startsWith(q) || l.startsWith(q)) return 0;
    if (h.includes(q) || l.includes(q)) return 1;
    return 2;
  };
  return targets
    .map(t => ({ t, s: score(t) }))
    .filter(x => x.s < 2)
    .sort((a, b) => a.s - b.s || Number(b.t.isAgent) - Number(a.t.isAgent) || a.t.label.localeCompare(b.t.label))
    .slice(0, limit)
    .map(x => x.t);
}

/** Replaces the @query at `start` with "@handle " and returns the new text and caret. */
export function insertMention(text: string, start: number, caret: number, handle: string): { text: string; caret: number } {
  const insert = `@${handle} `;
  return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length };
}

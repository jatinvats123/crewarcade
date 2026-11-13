// Planted-bug mutants for the playtester eval (eval/eval-playtest.ts).
// Each fixture game's file eval/mutants/<slug>.ts exports default an array of Mutant:
//   { id: '<slug>-<kind>', kind, description, apply(html) -> mutatedHtml }
// apply must be deterministic and must throw if its anchor isn't found (use replaceOnce), so a
// mutant can never silently become a clean copy.
export const KINDS = [
  'collision-disabled', // hazards no longer end the run
  'score-frozen', // score never increases
  'gameover-unreachable', // the run can never end
  'control-ignored', // one listed control key does nothing
  'console-error', // an error is logged when the game starts
  'fps-killer', // a busy loop per frame drops the frame rate
  'restart-broken', // Space/Enter after game over doesn't start a new run
] as const;
export type MutantKind = (typeof KINDS)[number];

export const KIND_TEXT: Record<MutantKind, string> = {
  'collision-disabled': 'hazards no longer end the run',
  'score-frozen': 'score never increases',
  'gameover-unreachable': 'the run can never end',
  'control-ignored': 'one listed control key does nothing',
  'console-error': 'an error is logged when the game starts',
  'fps-killer': 'a busy loop per frame drops the frame rate',
  'restart-broken': 'Space/Enter after game over does not start a new run',
};

export interface Mutant {
  id: string;
  kind: MutantKind;
  description: string;
  apply: (html: string) => string;
}

/** Replace exactly one occurrence of `find` (string or RegExp without /g); throws otherwise. */
export function replaceOnce(html: string, find: string | RegExp, repl: string): string {
  if (typeof find === 'string') {
    const n = html.split(find).length - 1;
    if (n !== 1) throw new Error(`anchor found ${n} times (need exactly 1): ${find.slice(0, 80)}`);
    return html.replace(find, () => repl);
  }
  const all = [...html.matchAll(new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g'))];
  if (all.length !== 1) throw new Error(`anchor found ${all.length} times (need exactly 1): ${String(find)}`);
  return html.replace(find, repl);
}

export interface ValidMutant extends Mutant {
  game: string;
  html: string;
}

/** Applies and validates every mutant of a game against its original HTML. */
export function validateMutants(game: string, original: string, list: unknown): { valid: ValidMutant[]; invalid: Array<{ id: string; reason: string }> } {
  const valid: ValidMutant[] = [];
  const invalid: Array<{ id: string; reason: string }> = [];
  if (!Array.isArray(list)) return { valid, invalid: [{ id: game, reason: 'default export is not an array' }] };
  const seen = new Set<string>();
  list.forEach((raw: unknown, i) => {
    const m = raw as Partial<Mutant> | null;
    const id = m && typeof m.id === 'string' && m.id ? m.id : `${game} mutant #${i + 1}`;
    const bad = (reason: string) => invalid.push({ id, reason });
    if (!m || typeof m !== 'object') return bad('not an object');
    if (!m.id) return bad('missing id');
    if (seen.has(id)) return bad('duplicate id');
    seen.add(id);
    if (!KINDS.includes(m.kind as MutantKind)) return bad(`kind "${String(m.kind)}" is not one of: ${KINDS.join(', ')}`);
    if (typeof m.apply !== 'function') return bad('apply is not a function');
    let html: string;
    let again: string;
    try {
      html = m.apply(original);
      again = m.apply(original);
    } catch (e) {
      return bad(`apply threw: ${(e as Error).message}`);
    }
    if (typeof html !== 'string') return bad('apply did not return a string');
    if (html === original) return bad('apply returned the original unchanged');
    if (again !== html) return bad('apply is not deterministic');
    valid.push({ ...(m as Mutant), game, html });
  });
  return { valid, invalid };
}

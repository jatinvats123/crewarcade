// The scenario step language (see docs/ENGINE.md). A scenario is an array of steps run in order on
// a fresh page (seed 42, paused fake clock), so the same steps always give the same result.
import { z } from 'zod';

/** Key names a scenario may press: KeyboardEvent.code values the headless player can send. */
export const KEYBOARD =
  /^(Arrow(Up|Down|Left|Right)|Key[A-Z]|Digit\d|Space|Enter|Shift(Left|Right)|Control(Left|Right)|Tab|Escape|Backspace)$/;

const label = z.string().min(1).max(200);

export const StepSchema = z.union([
  z.object({ seed: z.number().int() }).strict(),
  z.object({ call: z.enum(['start', 'reset']) }).strict(),
  z.object({ press: z.string().regex(KEYBOARD, 'unsupported key'), ms: z.number().int().min(1).max(120_000).optional() }).strict(),
  z.object({ wait: z.number().int().min(0).max(120_000) }).strict(),
  z.object({ mark: z.string().min(1).max(40) }).strict(),
  z.object({ log: z.string().min(1).max(40) }).strict(),
  z.object({ expect: z.string().min(1).max(500), label: label.optional() }).strict(),
]);
export type Step = z.infer<typeof StepSchema>;

export const ScenarioSchema = z.array(StepSchema).min(1).max(200);
export type Scenario = z.infer<typeof ScenarioSchema>;

/** A named scenario: a repro ("repro-1"), an earlier version's acceptance run, or a probe. */
export interface NamedScenario {
  name: string;
  steps: Scenario;
  /** The version the file came from, for regression labels such as "[v1 repro-1]". */
  version?: number;
}

export type ParseResult = { ok: true; steps: Scenario } | { ok: false; error: string };

/** Accepts `[...steps]` or `{ "steps": [...] }` (raw JSON text or an already-parsed value). */
export function parseScenario(raw: unknown): ParseResult {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch (e) {
      return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
    }
  }
  const list = Array.isArray(value) ? value : (value as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(list)) return { ok: false, error: 'expected an array of steps (or {"steps":[...]})' };
  const res = ScenarioSchema.safeParse(list);
  if (!res.success) {
    const first = res.error.issues[0];
    const where = first?.path.length ? `step ${Number(first.path[0]) + 1}` : 'scenario';
    return { ok: false, error: `${where}: ${first?.message ?? 'invalid'}` };
  }
  return { ok: true, steps: res.data };
}

/** Game time a scenario spends (press ms default 100, waits): used to plan a clip. */
export const scenarioMs = (steps: readonly Step[]): number =>
  steps.reduce((t, s) => t + ('press' in s ? (s.ms ?? 100) : 'wait' in s ? s.wait : 0), 0);

/** Labels of the expect steps, in order (what a report will list). */
export const expectLabels = (steps: readonly Step[]): string[] =>
  steps.flatMap(s => ('expect' in s ? [s.label ?? s.expect] : []));

/** The bug check of a repro: the last expect labelled "BUG ...", else the last expect. -1 if none. */
export function bugStepIndex(steps: readonly Step[]): number {
  const expects = steps.map((s, i) => ('expect' in s ? i : -1)).filter(i => i >= 0);
  const bug = [...expects].reverse().find(i => /^BUG/i.test((steps[i] as { label?: string }).label ?? ''));
  return bug ?? expects.at(-1) ?? -1;
}

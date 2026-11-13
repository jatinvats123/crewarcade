// GAME_SPEC: the plan Pixel writes and humans approve. Stored as JSON (game_versions.spec) and
// rendered as Markdown for the plan card and the builder's prompt. Format: docs/ENGINE.md.
import { z } from 'zod';
import { SLUG_RE } from './slug';

export const AcceptanceItemSchema = z.object({
  /** "A1", "A2", ... for v1; later versions continue the numbering ("A7", ...). */
  id: z.string().regex(/^A\d{1,2}$/),
  /** One checkable sentence that names the window.__crew field it reads. */
  text: z.string().min(5).max(300),
});
export type AcceptanceItem = z.infer<typeof AcceptanceItemSchema>;

export const SpecChangeSchema = z.object({
  version: z.number().int().min(2),
  /** Display names of the humans who asked for this change. */
  askedBy: z.array(z.string().max(64)).max(10),
  summary: z.string().min(3).max(600),
  hotfix: z.boolean().optional(),
  acceptance: z.array(AcceptanceItemSchema).max(8),
});
export type SpecChange = z.infer<typeof SpecChangeSchema>;

export const GameSpecSchema = z.object({
  title: z.string().min(2).max(40),
  slug: z.string().regex(SLUG_RE),
  pitch: z.string().min(10).max(200),
  /** Display names whose ideas went in. */
  credits: z.array(z.string().max(64)).max(20),
  remixOf: z.string().regex(SLUG_RE).optional(),
  approvedBy: z.array(z.string().max(64)).max(20),
  controls: z.object({ keyboard: z.string().min(3).max(200), touch: z.string().min(3).max(200) }),
  coreLoop: z.string().min(10).max(800),
  winLose: z.string().min(5).max(400),
  scoring: z.string().min(5).max(400),
  lookAndFeel: z.string().min(5).max(600),
  sound: z.string().min(3).max(400),
  acceptance: z.array(AcceptanceItemSchema).min(4).max(8),
  changes: z.array(SpecChangeSchema).max(50),
});
export type GameSpec = z.infer<typeof GameSpecSchema>;

/** Every acceptance item a version must meet: v1's list plus each change block up to `version`. */
export function acceptanceFor(spec: GameSpec, version: number): AcceptanceItem[] {
  return [...spec.acceptance, ...spec.changes.filter(c => c.version <= version).flatMap(c => c.acceptance)];
}

/** Markdown rendering for chat cards and agent prompts. */
export function specToMarkdown(spec: GameSpec): string {
  const list = (items: AcceptanceItem[]) => items.map(a => `${a.id.slice(1)}. ${a.text}`).join('\n');
  const out = [
    `# ${spec.title}`,
    `_${spec.pitch}_`,
    spec.remixOf ? `Remix of \`${spec.remixOf}\`.` : '',
    spec.credits.length ? `Ideas from: ${spec.credits.join(', ')}` : '',
    '## Controls',
    `Keyboard: ${spec.controls.keyboard}  \nTouch: ${spec.controls.touch}`,
    '## Core loop',
    spec.coreLoop,
    '## Win/Lose',
    spec.winLose,
    '## Scoring',
    spec.scoring,
    '## Look & feel',
    spec.lookAndFeel,
    '## Sound',
    spec.sound,
    '## Acceptance',
    list(spec.acceptance),
  ];
  for (const c of spec.changes)
    out.push(`## v${c.version} ${c.hotfix ? 'hotfix' : 'changes'}${c.askedBy.length ? ` (asked by ${c.askedBy.join(', ')})` : ''}`, c.summary, list(c.acceptance));
  return out.filter(Boolean).join('\n\n') + '\n';
}

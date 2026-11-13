// Pixel's structured output and the pure steps around it: language detection, normalization into
// the engine's GameSpec + the PlanCard content, and slug picking. No I/O here.
import { LANGUAGE_CODES, PlanCardContent, type LanguageCode } from '@crewarcade/shared';
import { GameSpecSchema, slugify, type GameSpec } from '@crewarcade/engine';
import { z } from 'zod';

/**
 * What Claude returns (structured output). Field order matters: `title` then `intro` come first so
 * the intro can be streamed to the chat while the rest is still being generated. Length limits are
 * enforced after the call (normalizePlan), not in the JSON schema.
 */
export const PixelPlanOutput = z.object({
  title: z.string().describe('Original game title, 2-40 characters, in the pitch language'),
  intro: z.string().describe("1-2 short excited sentences to the crew in the pitcher's language and style, naming the title in *italics*"),
  pitch: z.string().describe('One sentence, 10-200 characters'),
  controls: z.object({ keyboard: z.string(), touch: z.string() }),
  coreLoop: z.string(),
  winLose: z.string(),
  scoring: z.string(),
  lookAndFeel: z.string(),
  sound: z.string(),
  acceptance: z
    .array(z.object({ id: z.string().describe('A1, A2, ...'), text: z.string().describe('Checkable via window.__crew.state(); name the field it reads') }))
    .describe('4 to 8 items'),
  memoryNote: z.string().describe('One short preference this crew showed, e.g. "likes cute animals and Diwali themes"; empty if none'),
});
export type PixelPlanOutput = z.infer<typeof PixelPlanOutput>;

export class PlanShapeError extends Error {}

const clip = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

export interface PlanContext {
  gameId: string;
  planVersion: number;
  slug: string;
  language: LanguageCode;
  credits: string[];
  remixOf?: { title: string; slug: string } | undefined;
}

/** Clamps Claude's plan into the card/engine limits. Throws PlanShapeError when it cannot (fewer than 4 checks). */
export function normalizePlan(out: PixelPlanOutput, c: PlanContext): { card: PlanCardContent; spec: GameSpec } {
  const acceptance = out.acceptance
    .map(a => clip(a.text, 300))
    .filter(t => t.length >= 5)
    .slice(0, 8)
    .map((text, i) => ({ id: `A${i + 1}`, text }));
  if (acceptance.length < 4) throw new PlanShapeError(`plan has ${acceptance.length} acceptance items (need 4-8)`);
  const title = clip(out.title.replace(/[*_#`]/g, ''), 40);
  if (title.length < 2) throw new PlanShapeError('plan has no title');
  const pitch = clip(out.pitch, 200).padEnd(10, '.');
  const card = PlanCardContent.parse({
    v: 1,
    gameId: c.gameId,
    version: c.planVersion,
    title,
    slug: c.slug,
    pitch,
    controls: { keyboard: clip(out.controls.keyboard, 200).padEnd(3, '.'), touch: clip(out.controls.touch, 200).padEnd(3, '.') },
    coreLoop: clip(out.coreLoop, 800).padEnd(10, '.'),
    winLose: clip(out.winLose, 400).padEnd(5, '.'),
    scoring: clip(out.scoring, 400).padEnd(5, '.'),
    lookAndFeel: clip(out.lookAndFeel, 600).padEnd(5, '.'),
    sound: clip(out.sound, 400).padEnd(3, '.'),
    acceptance,
    language: c.language,
    credits: c.credits.slice(0, 20),
    ...(c.remixOf && { remixOf: c.remixOf.title }),
  });
  const spec = GameSpecSchema.parse({
    title: card.title,
    slug: c.slug,
    pitch: card.pitch,
    credits: card.credits,
    ...(c.remixOf && { remixOf: c.remixOf.slug }),
    approvedBy: [],
    controls: card.controls,
    coreLoop: card.coreLoop,
    winLose: card.winLose,
    scoring: card.scoring,
    lookAndFeel: card.lookAndFeel,
    sound: card.sound,
    acceptance: card.acceptance,
    changes: [],
  });
  return { card, spec };
}

/** A readable slug for a title: slugify(), padded or ASCII-fallback for non-Latin titles. */
export function baseSlug(title: string, fallback: string): string {
  const s = slugify(title) ?? slugify(fallback) ?? 'game';
  return s.slice(0, 26).replace(/-+$/, '');
}

/** First free slug: base, base-2, base-3... (each <= 30 chars). */
export function pickSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const s = `${base.slice(0, 30 - String(i).length - 1)}-${i}`;
    if (!taken.has(s)) return s;
  }
  throw new Error('no free slug');
}

// ---- language of a pitch ----------------------------------------------------------------------

const SCRIPTS: Array<[RegExp, LanguageCode]> = [
  [/[஀-௿]/, 'ta'],
  [/[ঀ-৿]/, 'bn'],
  [/[ఀ-౿]/, 'te'],
  [/[઀-૿]/, 'gu'],
  [/[ಀ-೿]/, 'kn'],
  [/[ഀ-ൿ]/, 'ml'],
  [/[؀-ۿ]/, 'ur'],
];
const MARATHI_HINTS = /(आहे|नाही|आणि|मध्ये|करा|हवा|पाहिजे)/;
const HINGLISH_WORDS = new Set(
  'hai hain ho tha thi karo kar karna karte banao bana banana wala wali wale nahi nahin bhai yaar ek aur mein me se ko ki ka ke kya kaise jaldi bahut accha acha chalo dekho jab tak sab kuch apna mera tera hum tum'.split(
    ' ',
  ),
);

export interface PitchLanguage {
  code: LanguageCode;
  /** Hindi written in Latin script ("ek chai cup jo scooter chalata hai"). */
  hinglish: boolean;
}

export function detectLanguage(text: string, userDefault: string = 'en'): PitchLanguage {
  for (const [re, code] of SCRIPTS) if (re.test(text)) return { code, hinglish: false };
  if (/[ऀ-ॿ]/.test(text)) return { code: MARATHI_HINTS.test(text) ? 'mr' : 'hi', hinglish: false };
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hits = words.filter(w => HINGLISH_WORDS.has(w)).length;
  if (words.length > 0 && hits >= 2 && hits / words.length >= 0.15) return { code: 'hi', hinglish: true };
  // Latin script without Hinglish markers is English; no letters at all (emoji only) -> the user's language.
  if (words.length > 0) return { code: 'en', hinglish: false };
  return { code: (LANGUAGE_CODES as readonly string[]).includes(userDefault) ? (userDefault as LanguageCode) : 'en', hinglish: false };
}

/** The 10-bullet crew memory: newest note first, no duplicates, each <= 80 chars. */
export function addMemory(memory: readonly string[], note: string, max = 10): string[] {
  const n = clip(note.replace(/^[-•*\s]+/, ''), 80);
  if (n.length < 4) return [...memory];
  return [n, ...memory.filter(m => m.toLowerCase() !== n.toLowerCase())].slice(0, max);
}

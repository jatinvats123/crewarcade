// FAKE_AGENTS=1: a drop-in AiClient with deterministic canned outputs and realistic delays, so the
// whole pipeline (router -> job -> agent state -> stream -> card -> ledger) runs without Claude.
// Used by e2e tests and as a demo safety net. Outputs are derived from the call's `hint` (the
// structured inputs the agent also sends to Claude), so the same pitch always gives the same plan.
import type { PlanCardContent } from '@crewarcade/shared';
import { fakeBuildOutput } from './fake-game';
import { channel, type AiClient, type AiUsage, type StructuredCall, type StructuredRun, type TextCall, type TextRun } from './claude';

export interface FakeOptions {
  /** 1 = realistic delays, 0 = instant (unit tests). */
  speed?: number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Deterministic 32-bit hash (FNV-1a). */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const STOP = new Set(
  'a an the of on in to and or with that who which is are be for from at by my our your their his her its this game make where jo hai ek ko ka ki ke se pe par mein me aur wala wali karo banao jisme'.split(
    ' ',
  ),
);
const SUFFIX = ['Dash', 'Rush', 'Rumble', 'Hop', 'Dodge', 'Sprint'];

/** A plausible title from a pitch: the first strong noun + a verb-ish suffix ("Chai Dash"). */
export function fakeTitle(pitch: string): string {
  const words = (pitch.toLowerCase().match(/[a-z]+/g) ?? []).filter(w => w.length > 2 && !STOP.has(w));
  const first = words[0];
  if (!first) return `Pixel ${SUFFIX[hash(pitch) % SUFFIX.length]}`;
  // The suffix depends on the hero word only, so "chai ..." pitches always become "Chai <same>".
  return `${first[0]!.toUpperCase()}${first.slice(1)} ${SUFFIX[hash(first) % SUFFIX.length]}`;
}

interface PlanHint {
  pitch: string;
  language: { code: string; hinglish: boolean };
  pitcher: string;
  previous?: PlanCardContent;
  change?: string;
  remixTitle?: string;
}

export function fakePlanOutput(h: PlanHint) {
  const prev = h.previous;
  const title = prev?.title ?? fakeTitle(h.remixTitle ? `${h.remixTitle} ${h.pitch}` : h.pitch);
  const hinglish = h.language.hinglish;
  const hindi = h.language.code === 'hi' && !hinglish;
  const intro = prev
    ? hinglish
      ? `Done! *${title}* update kar diya: ${h.change ?? ''}`.trim()
      : hindi
        ? `बढ़िया! *${title}* में बदलाव कर रहा हूँ।`
        : `On it! Updating *${title}*: ${(h.change ?? '').slice(0, 80)}`.trim()
    : hinglish
      ? `Arre wah, mast idea! *${title}* plan kar raha hoon…`
      : hindi
        ? `वाह, क्या आइडिया है! *${title}* का प्लान बना रहा हूँ…`
        : `Ooh, I love this! Planning *${title}*…`;
  const faster = /fast|speed|tez|तेज़|तेज/i.test(h.change ?? '');
  return {
    title,
    intro,
    pitch: prev?.pitch ?? `${h.pitch.slice(0, 180)}`.padEnd(10, '.'),
    controls: { keyboard: 'Left/Right arrows to switch lanes, Space to hop', touch: 'Tap the ◀ ▶ buttons to switch lanes, tap the screen to hop' },
    coreLoop: `Three lanes scroll toward you. Switch lanes and hop to dodge hazards and grab treats. The road gets ${faster ? 'much faster every 10 seconds' : 'a little faster every 15 seconds'}.`,
    winLose: 'You have 3 lives. Each hit costs one; at 0 lives the run is over. Beat your best score.',
    scoring: '+1 point every second you survive, +5 for each treat, combo x2 after 5 treats in a row.',
    lookAndFeel: 'Warm sunset gradient, emoji characters, bouncy squash on hops, particle bursts and a small screen shake on hits.',
    sound: 'Soft beep on treats, low buzz on hits, rising arpeggio on game over.',
    acceptance: [
      { id: 'A1', text: 'state().score rises while playing with no input.' },
      { id: 'A2', text: 'Pressing ArrowLeft or ArrowRight changes state().lane.' },
      { id: 'A3', text: 'Touching a hazard lowers state().lives by 1.' },
      { id: 'A4', text: "state().scene becomes 'over' when state().lives reaches 0." },
      { id: 'A5', text: `state().speed after 20 seconds is higher than at the start${faster ? ' (at least 1.5x)' : ''}.` },
    ],
    memoryNote: /chai|diwali|holi|cricket|samosa|auto|rickshaw/i.test(h.pitch)
      ? 'likes Indian everyday themes'
      : /cat|dog|penguin|panda|animal/i.test(h.pitch)
        ? 'likes cute animals'
        : '',
  };
}

function fakeExplain(hint: { question: string; plan: PlanCardContent; language: { code: string; hinglish: boolean } }): string {
  const p = hint.plan;
  if (hint.language.hinglish) return `*${p.title}* mein: ${p.controls.keyboard}. Phone pe: ${p.controls.touch}.\n${p.coreLoop}\nScore: ${p.scoring}`;
  return `Here's how it works in *${p.title}*:\n- Controls: ${p.controls.keyboard} (phone: ${p.controls.touch}).\n- ${p.coreLoop}\n- Scoring: ${p.scoring}\nForge decides the exact numbers when building.`;
}

const ZERO = (ms: number): AiUsage => ({ model: 'fake', tokensIn: 0, tokensOut: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, ms, fellBack: false });

export function createFakeAiClient(o: FakeOptions = {}): AiClient {
  const speed = o.speed ?? 1;
  const sleep = o.sleep ?? realSleep;
  const wait = (ms: number) => (speed > 0 ? sleep(ms * speed) : Promise.resolve());

  /** Streams `text` in small pieces like a model would. */
  async function trickle(text: string, push: (s: string) => void, perPieceMs = 45) {
    for (const piece of text.match(/.{1,6}/gsu) ?? []) {
      push(piece);
      await wait(perPieceMs);
    }
  }

  return {
    model: 'fake',
    structured<T>(call: StructuredCall<T>): StructuredRun<T> {
      const field = channel<string>();
      const done = (async () => {
        const t0 = Date.now();
        try {
          let raw: unknown;
          switch (call.purpose) {
            case 'pixel.plan':
            case 'pixel.revise': {
              await wait(1800); // "thinking"
              const out = fakePlanOutput(call.hint as unknown as PlanHint);
              if (call.streamField === 'intro') await trickle(out.intro, field.push);
              await wait(900); // the rest of the JSON
              raw = out;
              break;
            }
            case 'glitch.scenario': {
              // A generic scenario any working game passes: start, play 3 s, one labelled check per item.
              await wait(1500);
              const items = ((call.hint ?? {}) as { acceptance?: Array<{ id: string; text: string }> }).acceptance ?? [];
              raw = {
                steps: [
                  { call: 'start' },
                  { mark: 'a' },
                  { wait: 3000 },
                  ...items.map(a => ({ expect: "state.scene === 'playing' || state.scene === 'over'", label: `${a.id} ${a.text}`.slice(0, 120) })),
                ],
              };
              break;
            }
            case 'forge.build': {
              const h = (call.hint ?? {}) as Parameters<typeof fakeBuildOutput>[0];
              const out = fakeBuildOutput(h);
              await wait(1500);
              if (call.streamField === 'outline')
                for (const line of out.outline.split('\n')) {
                  field.push(`${line}\n`);
                  await wait(1200);
                }
              await wait(1500);
              raw = out;
              break;
            }
            case 'pixel.delta': {
              await wait(1500);
              const h = (call.hint ?? {}) as { change?: string; hindi?: boolean };
              const change = (h.change ?? 'small tweaks').slice(0, 200);
              raw = {
                intro: h.hindi ? `ठीक है! अगला वर्ज़न: ${change}` : `On it! Next version: ${change}`,
                summary: change.length >= 3 ? change : 'Small tweaks from the crew',
                acceptance: /fast|speed|tez|तेज/i.test(change) ? ['state().speed at the start is higher than in the previous version'] : [],
              };
              break;
            }
            default:
              throw new Error(`fake client has no structured output for ${call.purpose}`);
          }
          return { value: call.schema.parse(raw), usage: ZERO(Date.now() - t0) };
        } finally {
          field.end();
        }
      })();
      done.catch(() => {});
      return { fieldChunks: field.iterable, done };
    },
    streamText(call: TextCall): TextRun {
      const chunks = channel<string>();
      const done = (async () => {
        const t0 = Date.now();
        try {
          await wait(1200);
          const text =
            call.purpose === 'pixel.explain'
              ? fakeExplain(call.hint as unknown as Parameters<typeof fakeExplain>[0])
              : 'Happy to help! Pitch me a game idea with @pixel.';
          await trickle(text, chunks.push);
          return { text, usage: ZERO(Date.now() - t0) };
        } finally {
          chunks.end();
        }
      })();
      done.catch(() => {});
      return { chunks: chunks.iterable, done };
    },
  };
}

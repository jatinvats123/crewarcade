// GIFs of the playtester playing, made by the same player as the playtest (seed 42, paused fake
// clock on the 16 ms frame grid), so a clip is the test run with a camera on it.
//   clip:  ~6 s from start, cycling the game's own controls like the playtest's screenshot step.
//   repro: replays a bug repro and stops just after its BUG check: red banner if the check fails
//          (the bug, on camera), green if it passes.
//   fix:   the same repro on the old version (left) and the new one (right), frame-synced, each
//          side's check result under it.
// Frames: canvas only, 480x270 per side, one every 80 ms of game time (a longer repro becomes a
// time-lapse so the GIF stays <= 10 s). Over 5 MB: half the frames, re-encoded once. Math.random is
// seeded in the clip page (cosmetics), so the same inputs give the same bytes. No network.
import type { Browser, Page } from 'playwright';
import { bugStepIndex, KEYBOARD, scenarioMs, type Scenario, type Step } from './scenario';
import { SEED, freshPage, gameContext, launchBrowser, playSteps, readState, run, serveHtml, type Advance, type StepHooks } from './player';

const W = 480;
const H = 270;
const TOP = 28;
const BOTTOM = 30;
const STEP_MS = 80;
const MAX_FRAMES = 125;
const TAIL_MS = 500;
const MAX_BYTES = 5 * 1024 * 1024;
const HOLD_LAST_MS = 2000;

export interface ClipSide {
  html: string;
  version: number;
}

export type ClipInput =
  | { kind: 'clip'; title: string; game: ClipSide; browser?: Browser }
  | { kind: 'repro'; title: string; game: ClipSide; repro: { name: string; steps: Scenario }; browser?: Browser }
  | { kind: 'fix'; title: string; before: ClipSide; after: ClipSide; repro: { name: string; steps: Scenario }; browser?: Browser };

export interface ClipResult {
  gif: Buffer;
  width: number;
  height: number;
  frames: number;
  seconds: number;
  /** >1 when a long repro was sped up into a time-lapse. */
  speed: number;
  /** Per side (left to right): whether the bug check passed (undefined for a plain clip). */
  sides: Array<{ version: number; ok?: boolean; err?: string }>;
  /** The BUG check label (repro / fix). */
  checkLabel?: string;
  summary: string;
}

interface SideResult {
  version: number;
  frames: Buffer[];
  doneAt: number;
  ok?: boolean;
  err?: string;
}

interface BarSpec {
  w: number;
  h: number;
  bg: string;
  left?: string;
  right?: string;
  icon?: 'check' | 'x';
  iconColor?: string;
  tag?: string;
}

export async function clip(input: ClipInput): Promise<ClipResult> {
  const sidesIn = input.kind === 'fix' ? [input.before, input.after] : [input.game];
  let steps: Step[] = [];
  let bugIndex = -1;
  let checkLabel = '';
  if (input.kind !== 'clip') {
    bugIndex = bugStepIndex(input.repro.steps);
    if (bugIndex < 0) throw new Error(`${input.repro.name} has no expect step to check`);
    steps = input.repro.steps.slice(0, bugIndex + 1);
    const bugStep = steps[bugIndex] as Extract<Step, { expect: string }>;
    checkLabel = bugStep.label ?? bugStep.expect;
  }

  const pages: Record<string, string> = {};
  sidesIn.forEach((s, i) => (pages[`side${i}`] = s.html));
  const srv = await serveHtml(pages);
  const ownBrowser = !input.browser;
  const browser = input.browser ?? (await launchBrowser());
  // Zero network: only the private server.
  const ctx = await gameContext(browser, srv.origin);
  try {
    // Cosmetics (particles, stars, shake) use Math.random, so seed it (mulberry32) for
    // byte-identical clips; game logic already uses __crew.seed.
    await ctx.addInitScript(seed => {
      let a = seed >>> 0;
      Math.random = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }, SEED);

    // The plain clip plays like the playtest's screenshot step for ~6 s: hold a control, pause,
    // next; after a game over it waits 700 ms and starts again.
    if (input.kind === 'clip') {
      const probe = await freshPage(ctx, srv.url('side0'));
      const keys = (await probe.evaluate(() => (Array.isArray(window.__crew.controls) ? window.__crew.controls : []))).filter(k => KEYBOARD.test(k));
      await probe.close();
      steps = [{ call: 'start' }];
      for (let i = 0; i < 12; i++) steps.push(keys.length ? { press: keys[i % keys.length]!, ms: 250 } : { wait: 250 }, { wait: 250 });
    }
    // One frame every STEP_MS of game time; a long repro becomes a time-lapse of whole STEP_MS steps.
    const total = scenarioMs(steps) + TAIL_MS;
    const speed = Math.max(1, Math.ceil(total / STEP_MS / MAX_FRAMES));
    const every = STEP_MS * speed;

    // ---- play each side, capturing frames on the same game-time grid (so the sides stay in sync)
    const results: SideResult[] = [];
    for (const [i, side] of sidesIn.entries()) {
      const p = await freshPage(ctx, srv.url(`side${i}`));
      const frames: Buffer[] = [await grab(p)];
      let acc = 0;
      let res: { ok: boolean; err?: string } | null = null;
      let doneAt = -1;
      const advance: Advance = async (page, ms) => {
        while (ms > 0) {
          const d = Math.min(ms, every - acc);
          await run(page, d);
          acc += d;
          ms -= d;
          if (acc >= every) {
            acc = 0;
            frames.push(await grab(page));
          }
        }
      };
      const hooks: StepHooks = {
        advance,
        bad: (where, what, detail) => {
          throw new Error(`${where}: ${what}: ${detail}`);
        },
        expect: (_s, r, idx) => {
          if (idx === bugIndex) {
            res = r;
            doneAt = frames.length;
          }
        },
      };
      if (input.kind === 'clip') {
        await playSteps(p, steps.slice(0, 1), hooks);
        for (let k = 1; k < steps.length; k += 2) {
          await playSteps(p, steps.slice(k, k + 2), hooks);
          if ((await readState(p)).scene === 'over') {
            await advance(p, 700);
            await p.evaluate(() => window.__crew.start());
          }
        }
      } else await playSteps(p, steps, hooks);
      await advance(p, TAIL_MS);
      await p.close();
      const r = res as { ok: boolean; err?: string } | null;
      results.push({ version: side.version, frames, doneAt: doneAt < 0 ? frames.length : doneAt, ok: r?.ok, err: r?.err });
    }

    // ---- label bars, drawn once in a blank page (vector icons, no emoji font needed)
    const ink = await ctx.newPage();
    await ink.setContent('<canvas></canvas>');
    const bars = new Map<string, Buffer>();
    const bar = async (spec: BarSpec) => {
      const key = JSON.stringify(spec);
      if (!bars.has(key)) bars.set(key, Buffer.from(await ink.evaluate(drawBar, spec), 'base64'));
      return bars.get(key)!;
    };
    const speedNote = speed > 1 ? ` · ${speed}× speed` : '';
    const reproName = input.kind === 'clip' ? '' : input.repro.name;
    const verdict = (r: SideResult) => (r.ok ? { bg: '#1f9d55', icon: 'check' as const } : { bg: '#d7263d', icon: 'x' as const });
    const tops: Array<[Buffer, Buffer]> = [];
    const bottoms: Array<[Buffer, Buffer]> = [];
    for (const [i, r] of results.entries()) {
      if (input.kind === 'clip') {
        const t = await bar({ w: W, h: TOP, bg: '#0d0b1f', left: `${input.title} v${r.version}`, right: `Glitch · seed ${SEED} · the test's own run` });
        tops.push([t, t]);
      } else if (input.kind === 'repro') {
        const t = await bar({ w: W, h: TOP, bg: '#0d0b1f', left: `${input.title} v${r.version}`, right: `replaying ${reproName}${speedNote}` });
        tops.push([t, t]);
        bottoms.push([
          await bar({ w: W, h: BOTTOM, bg: '#2a2150', left: `checking: ${checkLabel}` }),
          await bar({ w: W, h: BOTTOM, ...verdict(r), left: r.ok ? `Passes: ${checkLabel}` : `Caught on camera: ${checkLabel}` }),
        ]);
      } else {
        const old = i === 0;
        const t = await bar({
          w: W,
          h: TOP,
          bg: '#0d0b1f',
          left: `v${r.version}`,
          icon: r.ok ? 'check' : 'x',
          iconColor: r.ok ? '#2ecc71' : '#ff4d5e',
          tag: old ? (r.ok ? 'no bug' : 'bug') : r.ok ? 'fixed' : 'still buggy',
          right: old ? `same moves (${reproName})` : `seed ${SEED}${speedNote}`,
        });
        tops.push([t, t]);
        bottoms.push([
          await bar({ w: W, h: BOTTOM, bg: '#2a2150', left: 'checking…' }),
          await bar({ w: W, h: BOTTOM, ...verdict(r), left: r.ok ? 'check passes' : `check fails: ${checkLabel}` }),
        ]);
      }
    }
    await ink.close();

    // ---- compose frames: [top bar / game / bottom bar] per side, sides left to right
    const count = Math.min(...results.map(r => r.frames.length));
    const FW = W * results.length;
    const FH = TOP + H + (bottoms.length ? BOTTOM : 0);
    const frames: Buffer[] = [];
    for (let f = 0; f < count; f++) {
      const out = Buffer.alloc(FW * FH * 4);
      results.forEach((r, s) => {
        const after = f >= r.doneAt ? 1 : 0;
        blit(out, FW, tops[s]![after], W, TOP, s * W, 0);
        blit(out, FW, r.frames[f]!, W, H, s * W, TOP);
        if (bottoms.length) blit(out, FW, bottoms[s]![after], W, BOTTOM, s * W, TOP + H);
      });
      frames.push(out);
    }

    // ---- encode (one global palette from a sample of frames, incl. the result frames)
    let delay = STEP_MS;
    let used = frames;
    let gif = await encodeGif(used, FW, FH, delay);
    if (gif.length > MAX_BYTES) {
      used = frames.filter((_, i) => i % 2 === 0 || i === frames.length - 1);
      delay *= 2;
      gif = await encodeGif(used, FW, FH, delay);
    }
    if (gif.length > MAX_BYTES) throw new Error(`GIF would be ${(gif.length / 1048576).toFixed(1)} MB even at half the frame rate (limit 5 MB)`);

    const seconds = +(((used.length - 1) * delay) / 1000).toFixed(1);
    const lines = [
      `CLIP ${input.kind}: ${(gif.length / 1048576).toFixed(2)} MB, ${used.length} frames, ${seconds} s${speed > 1 ? ` (${speed}x speed)` : ''}, ${FW}x${FH}`,
    ];
    if (input.kind !== 'clip')
      for (const r of results)
        lines.push(`v${r.version} ${reproName}: "${checkLabel}" ${r.ok ? 'PASSES' : 'FAILS'}${r.err ? ` (${r.err})` : ''}${r.ok ? '' : ' -> bug on camera'}`);
    if (input.kind === 'fix' && !(results[0]!.ok === false && results[1]!.ok === true))
      lines.push(`NOTE: expected v${results[0]!.version} to fail and v${results[1]!.version} to pass; the labels show what really happened`);
    return {
      gif,
      width: FW,
      height: FH,
      frames: used.length,
      seconds,
      speed,
      sides: results.map(r => ({ version: r.version, ok: r.ok, err: r.err })),
      ...(checkLabel && { checkLabel }),
      summary: lines.join('\n'),
    };
  } finally {
    await ctx.close().catch(() => {});
    if (ownBrowser) await browser.close().catch(() => {});
    await srv.close();
  }
}

interface GifEnc {
  GIFEncoder: () => {
    writeFrame(index: Uint8Array, w: number, h: number, o: { palette?: number[][]; delay?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  quantize: (rgba: Uint8Array, maxColors: number) => number[][];
  applyPalette: (rgba: Uint8Array, palette: number[][]) => Uint8Array;
}

/** Encodes RGBA frames as a looping GIF with one global palette sampled from 12 frames + the last. */
export async function encodeGif(list: Buffer[], width: number, height: number, delay: number): Promise<Buffer> {
  const mod = (await import('gifenc')) as unknown as GifEnc & { default?: GifEnc };
  const { GIFEncoder, quantize, applyPalette } = typeof (mod as Partial<GifEnc>).quantize === 'function' ? mod : mod.default!; // CJS build under Node
  const pick = [...new Set([...Array.from({ length: 12 }, (_, i) => Math.floor((i * (list.length - 1)) / 11)), list.length - 1])];
  const palette = quantize(Buffer.concat(pick.map(i => list[i]!)), 256);
  const gif = GIFEncoder();
  list.forEach((fr, i) =>
    gif.writeFrame(applyPalette(fr, palette), width, height, { palette: i === 0 ? palette : undefined, delay: i === list.length - 1 ? HOLD_LAST_MS : delay }),
  );
  gif.finish();
  return Buffer.from(gif.bytes());
}

/** The game canvas, letterboxed into W x H, as RGBA. */
async function grab(p: Page): Promise<Buffer> {
  const b64 = await p.evaluate(
    ([w, h]) => {
      const c = document.querySelector('canvas');
      const t = document.createElement('canvas');
      t.width = w;
      t.height = h;
      const g = t.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      if (c && c.width && c.height) {
        const s = Math.min(w / c.width, h / c.height);
        const dw = c.width * s;
        const dh = c.height * s;
        g.drawImage(c, (w - dw) / 2, (h - dh) / 2, dw, dh);
      }
      const d = g.getImageData(0, 0, w, h).data;
      let out = '';
      for (let i = 0; i < d.length; i += 0x8000) out += String.fromCharCode.apply(null, Array.from(d.subarray(i, i + 0x8000)));
      return btoa(out);
    },
    [W, H] as const,
  );
  return Buffer.from(b64, 'base64');
}

/** Copies a w x h RGBA block into dst (width dw) at x, y. */
function blit(dst: Buffer, dw: number, src: Buffer, w: number, h: number, x: number, y: number): void {
  for (let row = 0; row < h; row++) src.copy(dst, ((y + row) * dw + x) * 4, row * w * 4, (row + 1) * w * 4);
}

/** Runs in the page: draws one label bar and returns it as base64 RGBA. */
function drawBar({ w, h, bg, left = '', right = '', icon, iconColor = '#fff', tag }: BarSpec): string {
  const c = document.querySelector('canvas')!;
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.textBaseline = 'middle';
  const font = (wt: number, px: number) => `${wt} ${px}px "Segoe UI", system-ui, Roboto, Arial, sans-serif`;
  let x = 10;
  if (icon) {
    // a circle with a cross or a tick
    const r = h * 0.3;
    const cx = x + r;
    const cy = h / 2;
    g.fillStyle = iconColor;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = bg;
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.beginPath();
    if (icon === 'x') {
      const q = r * 0.45;
      g.moveTo(cx - q, cy - q);
      g.lineTo(cx + q, cy + q);
      g.moveTo(cx + q, cy - q);
      g.lineTo(cx - q, cy + q);
    } else {
      g.moveTo(cx - r * 0.5, cy);
      g.lineTo(cx - r * 0.1, cy + r * 0.4);
      g.lineTo(cx + r * 0.5, cy - r * 0.4);
    }
    g.stroke();
    x += r * 2 + 8;
  }
  const fit = (s: string, max: number) => {
    if (g.measureText(s).width <= max) return s;
    while (s.length > 1 && g.measureText(s + '…').width > max) s = s.slice(0, -1);
    return s + '…';
  };
  g.font = font(500, 12);
  const rw = right ? Math.min(g.measureText(right).width, w * 0.48) : 0;
  g.font = font(700, 14);
  g.fillStyle = '#f4f1ff';
  const lt = fit(left, w - x - rw - 24);
  g.fillText(lt, x, h / 2 + 1);
  x += g.measureText(lt).width + 8;
  if (tag) {
    g.fillStyle = iconColor;
    g.fillText(fit(tag, w - x - rw - 20), x, h / 2 + 1);
  }
  if (right) {
    g.font = font(500, 12);
    g.fillStyle = bg === '#0d0b1f' ? '#9a93c9' : '#f4f1ff';
    g.textAlign = 'right';
    g.fillText(fit(right, rw), w - 10, h / 2 + 1);
    g.textAlign = 'left';
  }
  const d = g.getImageData(0, 0, w, h).data;
  let out = '';
  for (let i = 0; i < d.length; i += 0x8000) out += String.fromCharCode.apply(null, Array.from(d.subarray(i, i + 0x8000)));
  return btoa(out);
}

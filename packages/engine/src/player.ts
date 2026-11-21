// The headless player shared by the playtester (the test) and the clipper (the GIF of the test).
// One browser setup, one fake clock, one scenario step runner: a clip is the same deterministic run
// as the playtest (seed 42, paused fake clock aligned to the 16 ms frame grid), just with a camera.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Browser, BrowserContext, Page } from 'playwright';
import { KEYBOARD, type Step } from './scenario';

export const SEED = 42;
export const VIEWPORT = { width: 960, height: 540 } as const;
/** CPU slowdown applied while measuring FPS, so the check reflects a mid-range phone, not a desktop. */
export const PHONE_CPU_THROTTLE = 4;

/** What window.__crew.state() returns: engine fields plus game-specific ones. */
export interface GameState {
  scene: 'title' | 'playing' | 'over' | string;
  score: number;
  best: number;
  time: number;
  frame?: number;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __crew: {
      state(): GameState;
      start(): GameState;
      reset(): GameState;
      seed(n: number): boolean;
      readonly controls: string[];
    };
  }
}

/** Playwright's chromium, imported lazily so the static checker never needs a browser. */
export async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    throw new Error('Playwright is missing. Run: pnpm install && pnpm --filter @crewarcade/engine exec playwright install chromium');
  }
}

/**
 * tsx/esbuild "keepNames" wraps functions in __name(...) calls; code we send to the page via
 * page.evaluate() would then throw "__name is not defined". Every context gets this no-op shim.
 */
export const NAME_SHIM = 'globalThis.__name = globalThis.__name || (fn => fn);';

/** A browser context for game pages: fixed viewport, the __name shim, and no network off `origin`. */
export async function gameContext(browser: Browser, origin: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await ctx.addInitScript({ content: NAME_SHIM });
  await ctx.route('**/*', r => (r.request().url().startsWith(origin) ? r.continue() : r.abort()));
  return ctx;
}

export async function launchBrowser(): Promise<Browser> {
  const chromium = await loadChromium();
  return chromium.launch({ headless: true });
}

export interface HtmlServer {
  origin: string;
  /** URL of a page by key, e.g. url('v1') -> http://127.0.0.1:PORT/v1/ */
  url(key: string): string;
  /** A host page that loads that game in <iframe sandbox="allow-scripts">, like the real player. */
  hostUrl(key: string): string;
  close(): Promise<void>;
}

/**
 * A private static server for in-memory HTML on a random localhost port. Games run from a real
 * origin (not about:blank) so localStorage works and any request off this origin is visible.
 */
export async function serveHtml(pages: Record<string, string>): Promise<HtmlServer> {
  const srv = http.createServer((req, res) => {
    const key = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/|\/$/g, '');
    const hostOf = key.endsWith('/host') ? key.slice(0, -5) : null;
    const html = hostOf !== null && pages[hostOf] !== undefined ? sandboxHost(`/${hostOf}/`) : pages[key];
    if (html === undefined) return void res.writeHead(404).end('Not found');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return {
    origin,
    url: key => `${origin}/${key}/`,
    hostUrl: key => `${origin}/${key}/host/`,
    close: () => new Promise<void>(r => srv.close(() => r())),
  };
}

/**
 * The sandbox host: the game in an iframe with `sandbox="allow-scripts"` only (opaque origin, no
 * storage, no top navigation, no popups), exactly how players and the playtest worker run games.
 */
export const sandboxHost = (src: string): string =>
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}iframe{border:0;display:block;width:100%;height:100%}</style><iframe sandbox="allow-scripts" src="${src}" title="game"></iframe>`;

/**
 * A Page whose evaluate() runs inside the sandboxed game frame; keyboard, clock, close and
 * mainFrame() stay on the host page (keys reach the focused iframe, the fake clock covers all frames).
 */
export async function gameView(p: Page): Promise<Page> {
  const el = await p.waitForSelector('iframe', { state: 'attached' });
  const frame = await el.contentFrame();
  if (!frame) throw new Error('the game frame did not load');
  await frame.waitForLoadState('load');
  await el.focus();
  await frame.evaluate(() => window.focus());
  return new Proxy(p, {
    get(target, prop) {
      if (prop === 'evaluate') return frame.evaluate.bind(frame);
      if (prop === 'gameFrame') return frame;
      const v: unknown = Reflect.get(target, prop, target);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

// On the paused clock a busy loop that waits on performance.now()/Date.now() never ends, which
// freezes the page; cap each advance in real time so that becomes a FAIL instead of a hang.
export const FREEZE_MS = 20_000;
export function guard<T>(clockMove: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const frozen = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`game froze: ${what} didn't finish in ${FREEZE_MS / 1000} s (a loop that waits on the clock?)`)), FREEZE_MS);
  });
  return Promise.race([clockMove, frozen]).finally(() => clearTimeout(timer));
}

// Long waits move the clock in 1 s slices, each under the guard: a healthy 60 s wait can take more
// than 20 s of real time on a slow machine (CI), while a frozen game stalls inside a single slice.
// The same timers fire at the same fake times as one big runFor, so results don't change.
export const CHUNK_MS = 1000;
export type Advance = (p: Page, ms: number) => Promise<void>;
export const run: Advance = async (p, ms) => {
  for (let done = 0; done < ms; done += CHUNK_MS) {
    const step = Math.min(CHUNK_MS, ms - done);
    await guard(p.clock.runFor(step), `${step} ms of game time (at ${done} of ${ms} ms)`);
  }
};

export async function hold(p: Page, key: string, ms: number, advance: Advance = run): Promise<void> {
  await p.keyboard.down(key);
  await advance(p, ms);
  await p.keyboard.up(key);
}

export const readState = (p: Page): Promise<GameState> => p.evaluate(() => window.__crew.state());

export interface FreshPageOptions {
  watch?: (p: Page) => void;
  seed?: number;
  /** url is a sandbox host page (HtmlServer.hostUrl); the returned page evaluates in the game frame. */
  sandbox?: boolean;
}

/** A fresh page on the fake clock, seeded and on the title screen. */
export async function freshPage(ctx: BrowserContext, url: string, { watch, seed = SEED, sandbox = false }: FreshPageOptions = {}): Promise<Page> {
  const host = await ctx.newPage();
  watch?.(host);
  await host.clock.install({ time: 0 });
  // Paused: otherwise real time keeps flowing into the fake clock, so a slow machine (CI) sees
  // extra game time and timing-tight checks differ between machines. Only run() moves time now.
  await host.clock.pauseAt(1000);
  await host.goto(url, { waitUntil: 'load' });
  const p = sandbox ? await gameView(host) : host;
  const ok = await p.evaluate(() => !!(window.__crew && window.__crew.state));
  if (!ok) throw new Error('window.__crew is missing');
  // Load time still depends on machine speed and fake frames fire on a 16 ms grid, so jump to the
  // next grid point >= 1 s ahead: one long frame that a fixed-step loop clamps, so every run lines up.
  const t = await p.evaluate(() => performance.now());
  await guard(p.clock.fastForward(1000 + ((16 - (t % 16)) % 16)), 'the first frame');
  await p.evaluate(s => {
    window.__crew.seed(s);
    window.__crew.reset();
  }, seed);
  return p;
}

export interface ExpectOutcome {
  ok: boolean;
  err?: string;
  state: GameState;
}

export interface StepHooks {
  /** Return true to stop before a step (time budget). */
  stop?: (where: string) => boolean;
  /** A step that cannot run (unknown call, unsupported key, unknown step shape). */
  bad?: (where: string, what: string, detail: string) => void;
  log?: (name: string, state: GameState) => void;
  expect?: (step: Extract<Step, { expect: string }>, res: ExpectOutcome, index: number) => void;
  /** Moves game time (default: run). The clipper passes one that grabs frames as time moves. */
  advance?: Advance;
}

/** Plays scenario steps on page p (step language: docs/ENGINE.md) and reports through hooks. */
export async function playSteps(p: Page, steps: readonly Step[], hooks: StepHooks = {}): Promise<void> {
  const advance = hooks.advance ?? run;
  const start = await readState(p);
  const marks: Record<string, GameState> = {};
  for (const [i, raw] of steps.entries()) {
    const s = raw as Record<string, unknown>;
    const where = `step ${i + 1}`;
    if (hooks.stop?.(where)) break;
    if (s.call !== undefined) {
      if (s.call !== 'start' && s.call !== 'reset') {
        hooks.bad?.(where, 'call', `unknown call "${String(s.call)}" (use start or reset)`);
        continue;
      }
      await p.evaluate(c => window.__crew[c](), s.call as 'start' | 'reset');
    } else if (s.seed !== undefined) {
      await p.evaluate(v => window.__crew.seed(v), Number(s.seed));
    } else if (s.press !== undefined) {
      const key = String(s.press);
      if (!KEYBOARD.test(key)) {
        hooks.bad?.(where, 'press', `unsupported key "${key}"`);
        continue;
      }
      await hold(p, key, Number(s.ms) || 100, advance);
    } else if (s.wait !== undefined) {
      await advance(p, Number(s.wait));
    } else if (s.mark !== undefined) {
      marks[String(s.mark)] = await readState(p);
    } else if (s.log !== undefined) {
      hooks.log?.(String(s.log), await readState(p));
    } else if (typeof s.expect === 'string') {
      const res = await p.evaluate(
        ({ expr, start, marks }) => {
          const state = window.__crew.state();
          // AI-written scenarios often call state() / start() / marks.a() like the window.__crew
          // hook. Each snapshot is both: reading fields works and calling it returns the snapshot.
          const both = (o: object): object => {
            const target = () => o;
            return new Proxy(target, {
              get: (t, k) => (k in o ? Reflect.get(o, k) : Reflect.get(t, k)),
              has: (_t, k) => k in o,
              ownKeys: () => Reflect.ownKeys(o),
              getOwnPropertyDescriptor: (t, k) => Reflect.getOwnPropertyDescriptor(o, k) ?? Reflect.getOwnPropertyDescriptor(t, k),
            });
          };
          const wrap = (o: unknown): unknown => (o !== null && typeof o === 'object' ? both(o) : o);
          const wrappedMarks = Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, wrap(v)]));
          try {
            const fn = new Function('state', 'start', 'marks', `return (${expr});`);
            return { ok: !!fn(wrap(state), wrap(start), wrappedMarks), state };
          } catch (e) {
            return { ok: false, err: (e as Error).message, state };
          }
        },
        { expr: s.expect, start, marks },
      );
      hooks.expect?.(raw as Extract<Step, { expect: string }>, res, i);
    } else {
      hooks.bad?.(where, 'unknown step', JSON.stringify(s).slice(0, 80));
    }
  }
}

// The headless playtester. Really plays a game in Chromium (960x540) and returns structured results.
//   Generic checks: static check, no console errors / network, __crew hook, title -> playing, canvas
//   changes, every control key has an effect, FPS, random input without exceptions, game over
//   reachable within 60 s with no input, restart from game over, reset() -> title, and the host
//   score hook (crewarcade:start / crewarcade:score postMessages).
//   Scenario checks: the acceptance scenario (one labelled expect per Acceptance item).
//   Regression: every saved bug repro must pass (hard); earlier versions' scenarios are advisory.
// Game time runs on Playwright's fake clock, so runs are deterministic (seed 42) and a 60 s game
// takes a few real seconds. `only` runs a single scenario (a repro or a probe) and nothing else.
import type { Browser, BrowserContext, Page } from 'playwright';
import { checkHtml } from './check';
import { KEYBOARD, type Scenario } from './scenario';
import {
  PHONE_CPU_THROTTLE,
  SEED,
  freshPage as openPage,
  gameContext,
  hold,
  launchBrowser,
  playSteps,
  readState,
  run,
  serveHtml,
  type GameState,
} from './player';

export type CheckKind = 'generic' | 'scenario' | 'repro' | 'regression' | 'only';

export interface PlaytestCheck {
  name: string;
  pass: boolean;
  detail: string;
  kind: CheckKind;
  /** Advisory checks are reported but never fail the playtest. */
  advisory?: boolean;
  /** Advisory checks skipped for the time budget. */
  skipped?: boolean;
}

/** A scenario from storage: parsed steps, or the reason it could not be parsed. */
export interface ScenarioRef {
  /** e.g. "repro-1", "scenario", "probe" */
  name: string;
  version?: number;
  steps: Scenario | null;
  error?: string;
}

export interface PlaytestInput {
  html: string;
  /** Shown in the summary line, e.g. "penguin-slide v2". */
  label?: string;
  /** The acceptance scenario for this version (null: missing). */
  scenario?: Scenario | null;
  /** Set when the stored scenario exists but failed to parse. */
  scenarioError?: string;
  /** Saved bug repros of versions <= this one: must pass. */
  repros?: ScenarioRef[];
  /** Earlier versions' acceptance scenarios: advisory. */
  previous?: ScenarioRef[];
  /** Run only this scenario (bug repro or probe); no generic checks, no screenshot. */
  only?: ScenarioRef;
  /** Real-time budget for the whole playtest (default 85 s). */
  budgetMs?: number;
  /** 'fast' shortens random input to 5 s and skips advisory replays (CI eval). */
  profile?: 'full' | 'fast';
  /** Reuse a launched browser (the eval runs many playtests). Not closed by playtest(). */
  browser?: Browser;
}

export interface PlaytestResult {
  pass: boolean;
  label: string;
  seed: number;
  fps: number;
  controls: string[];
  seconds: number;
  checks: PlaytestCheck[];
  /** Hard checks that failed. */
  failed: PlaytestCheck[];
  /** One entry per expect step that ran, in order. */
  expects: Array<{ label: string; pass: boolean; scenario: string }>;
  /** State snapshots from {"log": ...} steps: for exploring, never checks. */
  logs: string[];
  /** Mid-game canvas screenshot (PNG). Null in `only` mode or when the canvas is unreadable. */
  screenshot: Buffer | null;
  /** At most ~8 lines ending in PLAYTEST PASS / PLAYTEST FAIL. */
  summary: string;
}

declare global {
  interface Window {
    __crewHost?: Array<{ type: string; score?: unknown; best?: unknown; time?: unknown }>;
  }
}

/** 48x27 grayscale thumbnail of the canvas, to tell whether anything on screen changed. */
const pixels = (p: Page): Promise<number[]> =>
  p.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return [];
    const t = document.createElement('canvas');
    t.width = 48;
    t.height = 27;
    const g = t.getContext('2d');
    if (!g) return [];
    g.drawImage(c, 0, 0, 48, 27);
    const d = g.getImageData(0, 0, 48, 27).data;
    const out: number[] = [];
    for (let i = 0; i < d.length; i += 4) out.push((d[i]! + d[i + 1]! + d[i + 2]!) / 3);
    return out;
  });
export const pixDiff = (a: number[], b: number[]): number =>
  a.length && a.length === b.length ? a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0) / a.length : 0;
export const stateDiff = (a: GameState, b: GameState): string[] =>
  Object.keys({ ...a, ...b }).filter(k => !['time', 'frame'].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));

const hostMessages = (p: Page) => p.evaluate(() => window.__crewHost ?? []);

export async function playtest(input: PlaytestInput): Promise<PlaytestResult> {
  const T0 = Date.now();
  const budget = input.budgetMs ?? 85_000;
  const deadline = T0 + budget;
  const timeLeft = () => deadline - Date.now();
  const fast = input.profile === 'fast';
  const label = input.label ?? 'game';
  const checks: PlaytestCheck[] = [];
  const logs: string[] = [];
  const expects: PlaytestResult['expects'] = [];
  const add = (name: string, pass: unknown, detail: unknown = '', kind: CheckKind = 'generic', advisory = false) => {
    checks.push({ name, pass: !!pass, detail: String(detail).slice(0, 300), kind, ...(advisory && { advisory: true }) });
    return !!pass;
  };

  if (!input.only) {
    const st = checkHtml(input.html);
    add('static check', st.pass, st.pass ? 'CHECK PASS' : st.problems.slice(0, 3).join(' | '));
  }

  const srv = await serveHtml({ game: input.html });
  const gameUrl = srv.url('game');
  const ownBrowser = !input.browser;
  const browser = input.browser ?? (await launchBrowser());
  let ctx: BrowserContext | null = null;
  const errors: string[] = []; // console errors, uncaught exceptions and off-origin requests, from every page
  const watch = (p: Page) => {
    p.on('pageerror', e => errors.push(`exception: ${e.message}`));
    p.on('console', m => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    p.on('request', r => {
      if (!r.url().startsWith(srv.origin)) errors.push(`network request: ${r.url()}`);
    });
  };

  let fps = 0;
  let controls: string[] = [];
  let screenshot: Buffer | null = null;
  try {
    // Anything off the private origin is blocked (the game must not need it); host messages are recorded.
    ctx = await gameContext(browser, srv.origin);
    await ctx.addInitScript(() => {
      window.__crewHost = [];
      window.addEventListener('message', e => {
        const d = e.data as { type?: unknown } | null;
        if (d && typeof d.type === 'string' && d.type.startsWith('crewarcade:')) window.__crewHost!.push(d as { type: string });
      });
    });
    const c = ctx;
    const freshPage = () => openPage(c, gameUrl, { watch });

    /** Runs one scenario on a fresh page. Each expect becomes a check named `<tag> <label>`. */
    const runScenario = async (steps: Scenario, tag: string, kind: CheckKind, advisory = false) => {
      const pre = tag ? `${tag} ` : '';
      const p = await freshPage();
      await playSteps(p, steps, {
        stop: where => {
          if (timeLeft() >= 5_000) return false;
          // An advisory replay cut short by the budget is skipped; a hard scenario cut short fails.
          if (advisory) checks.push({ name: `${pre}${where}: skipped`, pass: true, detail: 'skipped: time budget', kind, advisory: true, skipped: true });
          else add(`${pre}${where}: time budget`, false, 'playtest ran out of time', kind);
          return true;
        },
        bad: (where, what, detail) => add(`${pre}${where}: ${what}`, false, detail, kind, advisory),
        log: (name, st) => logs.push(`LOG ${pre}${name}: ${JSON.stringify(st)}`.slice(0, 240)),
        expect: (s, res) => {
          const brief = JSON.stringify(res.state).slice(0, 160);
          const name = pre + (s.label ?? s.expect);
          add(name, res.ok, res.err ? `error in "${s.expect}": ${res.err}` : `${s.expect} -> state ${brief}`, kind, advisory);
          expects.push({ label: s.label ?? s.expect, pass: res.ok, scenario: tag || 'scenario' });
        },
      });
      await p.close();
    };
    const runRef = async (ref: ScenarioRef, kind: CheckKind, advisory = false) => {
      const tag = `[${ref.version ? `v${ref.version} ` : ''}${ref.name}]`;
      if (ref.error || !ref.steps) add(`${tag} valid`, false, ref.error ?? 'no steps', kind, advisory);
      else await runScenario(ref.steps, tag, kind, advisory);
    };

    if (input.only) {
      await runRef(input.only, 'only');
    } else {
      // 1. Real-time load: errors, hook, title, FPS.
      const live = await c.newPage();
      watch(live);
      await live.goto(gameUrl, { waitUntil: 'load' });
      await live.waitForTimeout(400);
      const hook = await live.evaluate(() => {
        const j = window.__crew as Partial<Window['__crew']> | undefined;
        if (!j) return null;
        const fns = (['state', 'start', 'reset', 'seed'] as const).filter(f => typeof j[f] === 'function');
        return { fns, controls: Array.isArray(j.controls) ? j.controls : null };
      });
      add(
        '__crew hook',
        hook && hook.fns.length === 4 && hook.controls,
        hook ? `functions: ${hook.fns.join(',')}; controls: ${JSON.stringify(hook.controls)}` : 'window.__crew missing',
      );
      if (!hook || hook.fns.length < 4) throw new Error('cannot play without window.__crew');
      controls = hook.controls ?? [];
      add('loads without errors', errors.length === 0, errors.slice(0, 2).join(' | '));
      const s0 = await live.evaluate(() => window.__crew.state());
      add('starts on title screen', s0.scene === 'title', `scene=${s0.scene}`);
      await live.evaluate(() => window.__crew.start());
      // Measure while the CPU is throttled like a mid-range phone: a game that only reaches 60 fps
      // on a fast desktop is not playable on the phones our players use.
      const cdp = await c.newCDPSession(live);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: PHONE_CPU_THROTTLE });
      fps = await live.evaluate(
        () =>
          new Promise<number>(res => {
            let f = 0;
            const t0 = performance.now();
            const tick = () => {
              f++;
              if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
              else res(Math.round((f * 1000) / (performance.now() - t0)));
            };
            requestAnimationFrame(tick);
          }),
      );
      add('frame rate >= 30 fps', fps >= 30, `${fps} fps in headless Chromium at ${PHONE_CPU_THROTTLE}x CPU throttle (phone-class)`);
      await live.close();

      // 2. title -> playing, the start hook fires, and the screen moves.
      let p = await freshPage();
      const before = await pixels(p);
      const s1 = await p.evaluate(() => window.__crew.start());
      add('start() -> playing', s1.scene === 'playing', `scene=${s1.scene}`);
      await run(p, 1000);
      const startMsgs = (await hostMessages(p)).filter(m => m.type === 'crewarcade:start');
      add('score hook: crewarcade:start posted', startMsgs.length > 0, `${startMsgs.length} start message(s) after start()`);
      add('canvas changes within 1 s', pixDiff(before, await pixels(p)) > 0.5, 'compared 48x27 thumbnails');
      await p.close();

      // 3. Each control key changes the state or the picture (vs. the same run with no input). Runs
      //    before the scenario: it is cheap, and a key skipped for time would hide a dead control.
      const keyList = controls.filter(k => KEYBOARD.test(k));
      if (!keyList.length) add('controls listed', false, `__crew.controls has no keyboard keys: ${JSON.stringify(controls)}`);
      const base = await freshPage();
      await base.evaluate(() => window.__crew.start());
      await run(base, 600);
      const baseState = await readState(base);
      const basePix = await pixels(base);
      await base.close();
      for (const key of keyList) {
        const q = await freshPage();
        await q.evaluate(() => window.__crew.start());
        await hold(q, key, 600);
        const ds = stateDiff(baseState, await readState(q));
        const dp = pixDiff(basePix, await pixels(q));
        add(
          `key ${key} has an effect`,
          ds.length || dp > 0.5,
          ds.length ? `changes ${ds.slice(0, 4).join(', ')}` : dp > 0.5 ? 'changes the picture' : 'no change to state or picture after 600 ms',
        );
        await q.close();
      }

      // 4. The acceptance scenario and every saved bug repro run before the generic checks below,
      //    which shrink themselves to fit the remaining time budget.
      if (input.scenarioError) add('scenario valid', false, input.scenarioError, 'scenario');
      else if (!input.scenario) add('scenario present', false, 'missing: the playtester writes it from the Acceptance list', 'scenario');
      else await runScenario(input.scenario, '', 'scenario');
      for (const r of input.repros ?? []) await runRef(r, 'repro');

      // 5. Mid-game screenshot (canvas only, after 2.5 s of play with some input).
      p = await freshPage();
      await p.evaluate(() => window.__crew.start());
      for (let i = 0; i < 5; i++) {
        if (keyList.length) await hold(p, keyList[i % keyList.length]!, 250);
        else await run(p, 250);
        await run(p, 250);
      }
      const png = await p.evaluate(() => document.querySelector('canvas')?.toDataURL('image/png') ?? '');
      if (png.startsWith('data:image/png;base64,')) screenshot = Buffer.from(png.split(',')[1]!, 'base64');
      await p.close();

      // 6. Random input (20 s, 5 s in fast mode): no exceptions.
      p = await freshPage();
      await p.evaluate(() => window.__crew.start());
      const errBefore = errors.length;
      let r = 7;
      let restarts = 0;
      const rnd = () => (r = (r * 1103515245 + 12345) % 2147483648) / 2147483648;
      const pool = [...keyList, 'Space', 'Enter'];
      const randomMs = fast ? 5_000 : 20_000;
      for (let t = 0; t < randomMs && timeLeft() > 30_000;) {
        const ms = 100 + Math.floor(rnd() * 300);
        await hold(p, pool[Math.floor(rnd() * pool.length)]!, ms);
        t += ms;
        if ((await readState(p)).scene === 'over') {
          await run(p, 700);
          await p.evaluate(() => window.__crew.start());
          restarts++;
          t += 700;
        }
      }
      add(
        `${randomMs / 1000} s random input, no exceptions`,
        errors.length === errBefore,
        errors.length > errBefore ? errors.slice(errBefore, errBefore + 2).join(' | ') : `${restarts} restarts`,
      );
      await p.close();

      // 7. Game over reachable within 60 s with no input, the score hook reports it, then restart;
      //    reset() -> title.
      p = await freshPage();
      await p.evaluate(() => window.__crew.start());
      let over = false;
      let secs = 0;
      for (; secs < 60 && timeLeft() > 15_000; secs++) {
        await run(p, 1000);
        if ((await readState(p)).scene === 'over') {
          over = true;
          break;
        }
      }
      const scenarioCoversOver = (input.scenario ?? []).some(s => 'expect' in s && s.expect.includes("'over'"));
      if (over) {
        add('game over reachable (no input)', true, `over after ${secs + 1} s`);
        const st = await readState(p);
        const msg = (await hostMessages(p)).filter(m => m.type === 'crewarcade:score').at(-1);
        add(
          'score hook: crewarcade:score posted',
          msg && msg.score === st.score && typeof msg.best === 'number' && typeof msg.time === 'number',
          msg
            ? `score=${String(msg.score)} best=${String(msg.best)} time=${String(msg.time)} (state score=${st.score})`
            : 'no crewarcade:score message after game over',
        );
        await run(p, 800);
        await p.keyboard.press('Space');
        await run(p, 100);
        const sr = await readState(p);
        add('restart from game over', sr.scene === 'playing', `Space after game over -> scene=${sr.scene}`);
      } else {
        add(
          'game over reachable (no input)',
          scenarioCoversOver,
          scenarioCoversOver ? 'not with no input; the scenario covers it' : `still playing after ${secs} s with no input`,
        );
      }
      const rs = await p.evaluate(() => window.__crew.reset());
      add('reset() -> title', rs.scene === 'title', `scene=${rs.scene}`);
      await p.close();

      // 8. Advisory replays of earlier versions' scenarios, last and only if time allows.
      for (const ref of input.previous ?? []) {
        const tag = `[${ref.version ? `v${ref.version} ` : ''}${ref.name}]`;
        if (fast || timeLeft() < 20_000) {
          checks.push({
            name: `${tag} skipped`,
            pass: true,
            detail: fast ? 'skipped: fast profile' : 'skipped: time budget',
            kind: 'regression',
            advisory: true,
            skipped: true,
          });
          continue;
        }
        await runRef(ref, 'regression', true);
      }
    }
  } catch (e) {
    add('playtest ran to the end', false, (e as Error).message.split('\n')[0]);
  } finally {
    await ctx?.close().catch(() => {});
    if (ownBrowser) await browser.close().catch(() => {});
    await srv.close();
  }

  const hard = checks.filter(c => !c.advisory);
  const adv = checks.filter(c => c.advisory && !c.skipped);
  const advSkipped = checks.filter(c => c.skipped).length;
  const failed = hard.filter(c => !c.pass);
  const advFailed = adv.filter(c => !c.pass);
  const pass = failed.length === 0;
  const seconds = +((Date.now() - T0) / 1000).toFixed(1);
  const lines = [
    input.only
      ? `${label} ${input.only.name}: ${hard.length - failed.length}/${hard.length} checks passed, ${seconds}s`
      : `${label}: ${hard.length - failed.length}/${hard.length} checks passed, ${fps} fps, ${seconds}s`,
    ...logs.slice(0, 20),
    ...failed.slice(0, 4).map(c => `FAIL ${c.name}: ${c.detail}`.slice(0, 200)),
  ];
  if (adv.length || advSkipped)
    lines.push(
      (
        `Advisory (earlier versions' scenarios): ${adv.length - advFailed.length}/${adv.length} still hold` +
        (advFailed.length ? `; first change: ${advFailed[0]!.name}` : '') +
        (advSkipped ? `; ${advSkipped} skipped` : '')
      ).slice(0, 200),
    );
  lines.push(pass ? 'PLAYTEST PASS' : 'PLAYTEST FAIL');
  return { pass, label, seed: SEED, fps, controls, seconds, checks, failed, expects, logs, screenshot, summary: lines.join('\n') };
}

/** The JSON-safe report stored in game_versions.playtest (screenshot stored separately). */
export function playtestReport(r: PlaytestResult) {
  const { screenshot, summary, ...rest } = r;
  return { ...rest, hasScreenshot: !!screenshot, when: new Date().toISOString() };
}

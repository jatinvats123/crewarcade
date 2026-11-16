// Forge's smoke playtest: after the static check passes, play the game for a few seconds of game
// time in headless Chromium (the engine's deterministic fake clock, seed 42) and check that it
// starts, the score rises (or the run ends), and nothing throws. Problems go back to Forge as
// numbered items, like static-check problems. Glitch's full playtest (Phase 4) still follows; this
// only catches games that are dead on arrival (e.g. addScore(Math.round(dt * 10)) is always 0).
import { launchBrowser, playtest } from '@crewarcade/engine';

type Browser = Awaited<ReturnType<typeof launchBrowser>>;

export const SMOKE_STEPS = [
  { call: 'start' as const },
  { mark: 'a' },
  { wait: 6000 },
  { expect: "state.scene === 'playing' || state.scene === 'over'", label: 'the game starts' },
  { expect: "state.scene === 'over' || state.score > marks.a.score", label: 'the score rises while playing' },
];

/** Turns a playtest result into Forge-readable problems (empty = smoke passed). */
export function smokeFindings(r: { checks: Array<{ name: string; pass: boolean; detail: string; advisory?: boolean }>; logs: string[] }): string[] {
  const out: string[] = [];
  for (const c of r.checks.filter(c => !c.pass && !c.advisory)) {
    const what = c.name.replace(/^\[smoke\]\s*/, '');
    out.push(
      /score rises/.test(what)
        ? `Smoke test: after 6 s of play the score did not rise (${c.detail.slice(0, 160)}). addScore() needs whole numbers; per-frame amounts like dt * 10 round to 0, so accumulate time and add whole points.`
        : `Smoke test: ${what} failed (${c.detail.slice(0, 160)}).`,
    );
  }
  const err = r.logs.find(l => /error|exception|uncaught/i.test(l));
  if (err) out.push(`Smoke test: the page logged an error: ${err.slice(0, 200)}`);
  return out;
}

/** One shared browser per process, launched on first use. */
export function createSmoke(): { run: (html: string) => Promise<string[]>; close: () => Promise<void> } {
  let browser: Promise<Browser> | null = null;
  return {
    async run(html) {
      browser ??= launchBrowser();
      const b = await browser;
      const r = await playtest({ html, label: 'smoke', only: { name: 'smoke', steps: SMOKE_STEPS }, profile: 'fast', budgetMs: 30_000, browser: b });
      return smokeFindings(r);
    },
    async close() {
      if (browser) await (await browser).close().catch(() => {});
      browser = null;
    },
  };
}

// Integration tests: launch headless Chromium and really play games through the library API.
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { clip } from '../src/clip';
import { findRepro, loadVersion } from '../src/disk';
import { launchBrowser } from '../src/player';
import { playtest } from '../src/playtest';
import { replaceGameRegion, starterHtml } from '../src/versions';

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures', 'games');
let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser?.close();
});

describe('playtest()', () => {
  it('passes the starter demo with a minimal scenario and returns structured results', async () => {
    const res = await playtest({
      html: starterHtml(),
      label: 'starter',
      scenario: [{ call: 'start' }, { mark: 'a' }, { wait: 2000 }, { expect: "state.scene === 'playing' || state.scene === 'over'", label: 'A1 runs' }],
      profile: 'fast',
      browser,
    });
    expect(res.failed).toEqual([]);
    expect(res.pass).toBe(true);
    expect(res.fps).toBeGreaterThan(0);
    expect(res.controls).toEqual(['ArrowLeft', 'ArrowRight']);
    expect(res.expects).toEqual([{ label: 'A1 runs', pass: true, scenario: 'scenario' }]);
    expect(res.screenshot?.subarray(1, 4).toString()).toBe('PNG');
    expect(res.checks.map(c => c.name)).toEqual(expect.arrayContaining(['score hook: crewarcade:start posted', 'score hook: crewarcade:score posted']));
    expect(res.summary).toMatch(/PLAYTEST PASS$/);
  });

  it('fails a game whose score hook was removed and one that logs errors', async () => {
    const noHook = starterHtml().replace("notifyHost({ type: 'crewarcade:start' });", '');
    const errors = replaceGameRegion(
      starterHtml(),
      starterHtml().split('// === GAME START ===')[1]!.split('// === GAME END ===')[0]!.replace('init() {', "init() { console.error('boom');"),
    );
    const [a, b] = await Promise.all([
      playtest({ html: noHook, scenario: [{ call: 'start' }, { expect: 'true' }], profile: 'fast', browser }),
      playtest({ html: errors, scenario: [{ call: 'start' }, { expect: 'true' }], profile: 'fast', browser }),
    ]);
    expect(a.pass).toBe(false);
    expect(a.failed.map(c => c.name)).toContain('score hook: crewarcade:start posted');
    expect(b.pass).toBe(false);
    expect(b.failed.map(c => c.name)).toContain('loads without errors');
  });

  it('reproduces a saved bug on the old version only (only mode)', async () => {
    const repro = findRepro(FIXTURES, 'penguin-slide', 'repro-1.json')!;
    const v1 = loadVersion(FIXTURES, 'penguin-slide', 1);
    const v2 = loadVersion(FIXTURES, 'penguin-slide', 2);
    const [old, fixed] = await Promise.all([playtest({ ...v1, only: repro, browser }), playtest({ ...v2, only: repro, browser })]);
    expect(old.pass).toBe(false);
    expect(old.expects[0]).toMatchObject({ pass: false, label: expect.stringMatching(/^BUG 1/) });
    expect(fixed.pass).toBe(true);
    expect(old.screenshot).toBeNull();
  });
});

describe('clip()', () => {
  it('makes a deterministic GIF of the test run', async () => {
    const game = { html: loadVersion(FIXTURES, 'comet-dash', 1).html, version: 1 };
    const a = await clip({ kind: 'clip', title: 'Comet Dash', game, browser });
    const b = await clip({ kind: 'clip', title: 'Comet Dash', game, browser });
    expect(a.gif.subarray(0, 6).toString()).toBe('GIF89a');
    expect(a.width).toBe(480);
    expect(a.frames).toBeGreaterThan(20);
    expect(a.gif.equals(b.gif)).toBe(true);
  });

  it('puts the bug on camera next to the fix', async () => {
    const repro = findRepro(FIXTURES, 'penguin-slide', 'repro-1.json')!;
    const res = await clip({
      kind: 'fix',
      title: 'Penguin Slide',
      before: { html: loadVersion(FIXTURES, 'penguin-slide', 1).html, version: 1 },
      after: { html: loadVersion(FIXTURES, 'penguin-slide', 2).html, version: 2 },
      repro: { name: 'repro-1', steps: repro.steps! },
      browser,
    });
    expect(res.width).toBe(960);
    expect(res.sides).toEqual([
      { version: 1, ok: false, err: undefined },
      { version: 2, ok: true, err: undefined },
    ]);
    expect(res.checkLabel).toMatch(/^BUG 1/);
  });
});

describe('the starter inside the CrewArcade player sandbox', () => {
  // The web player embeds games with sandbox="allow-scripts" and no allow-same-origin: storage
  // APIs throw there. The engine must still boot, play and post the score hook to the parent.
  it('boots, plays and reports scores in an iframe with sandbox="allow-scripts" (opaque origin)', async () => {
    const page = await browser.newPage();
    try {
      const html = starterHtml();
      await page.setContent(
        `<!doctype html><body style="margin:0"><iframe id="g" sandbox="allow-scripts allow-pointer-lock" style="width:480px;height:640px;border:0"></iframe></body>`,
      );
      await page.evaluate(src => {
        (window as unknown as { got: unknown[] }).got = [];
        window.addEventListener('message', e => (window as unknown as { got: unknown[] }).got.push({ origin: e.origin, data: e.data }));
        (document.getElementById('g') as HTMLIFrameElement).srcdoc = src;
      }, html);
      await expect.poll(() => page.frames().length).toBeGreaterThan(1);
      const frame = page.frames()[1]!;
      await frame.waitForFunction(() => typeof (window as unknown as { __crew?: unknown }).__crew === 'object', undefined, { timeout: 10_000 });
      const storageThrows = await frame.evaluate(() => {
        try {
          void window.localStorage.length;
          return false;
        } catch {
          return true;
        }
      });
      expect(storageThrows).toBe(true); // proves this really is the sandboxed case
      const crew = () => (window as unknown as { __crew: { start(): { scene: string }; state(): { scene: string } } }).__crew;
      expect(await frame.evaluate(`(${crew.toString()})().start().scene`)).toBe('playing');
      await frame.evaluate(`(${crew.toString()})(); window.gameOver && window.gameOver()`);
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { got: Array<{ origin: string; data: { type?: string } }> }).got.map(m => `${m.origin}|${m.data.type}`)),
        )
        .toContain('null|crewarcade:start');
    } finally {
      await page.close();
    }
  });
});

// Phase 3 UI without Nexconn or a server: the Build card states on /dev/ui, ▶ Play opening the
// full-screen sandboxed player, keyboard + tap input reaching the game, and the score hook posting
// to /api/scores. The play URL, the game file and the score API are mocked here; the game is the
// engine's own starter (its built-in demo), served with the same CSP the server uses.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Frame, type Page } from '@playwright/test';

// Playwright runs from apps/web.
const GAME_HTML = readFileSync(path.resolve(process.cwd(), '../../packages/engine/starter/index.html'), 'utf8');
const PLAY_URL = 'https://play.test/play/sample-scooter-run/v/1?t=1999999999999.abcdefghijklmnopqrstuv';
const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-ancestors *";

async function mockPlay(page: Page): Promise<{ scores: unknown[] }> {
  const scores: unknown[] = [];
  await page.route('**/api/games/gDemo/versions/*/play', route =>
    route.fulfill({
      json: {
        url: PLAY_URL,
        expiresAt: Date.now() + 60_000,
        gameId: 'gDemo',
        slug: 'sample-scooter-run',
        title: 'Sample Scooter Run',
        version: 1,
        orientation: 'any',
      },
    }),
  );
  await page.route('https://play.test/**', route =>
    route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: GAME_HTML }),
  );
  await page.route('**/api/scores', async route => {
    scores.push(route.request().postDataJSON());
    await route.fulfill({ json: { accepted: true, best: 42, rank: 1, newBest: true } });
  });
  return { scores };
}

async function gameFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some(f => f.url().startsWith('https://play.test/')), { timeout: 15_000 }).toBe(true);
  const frame = page.frames().find(f => f.url().startsWith('https://play.test/'))!;
  await frame.waitForFunction(() => typeof (window as unknown as { __crew?: unknown }).__crew === 'object');
  return frame;
}

test.describe('Build card and player (gallery)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByTestId('cards-demo').scrollIntoViewIfNeeded();
  });

  test('a build shows live progress lines; ready shows notes; failed shows problems and Try again', async ({ page }) => {
    const demo = page.getByTestId('cards-demo');
    const building = demo.locator('article', { hasText: 'Change: Make it faster' });
    await expect(building.getByText('Building')).toBeVisible();
    await expect(building.getByRole('list', { name: 'Build progress' }).getByRole('listitem')).toHaveCount(5);
    await expect(building.getByText('Potholes + speed ramp')).toBeVisible();
    await expect(building.getByText('Change: Make it faster')).toBeVisible();

    const ready = demo.locator('article', { hasText: 'Dodge potholes, grab biscuits' });
    await expect(ready.getByText('18.4 KB · 64 s')).toBeVisible();
    await expect(ready.getByText('Dodge potholes, grab biscuits for +10.')).toBeVisible();
    await expect(ready.getByRole('button', { name: '▶ Play' })).toBeVisible();

    const failed = demo.locator('article', { hasText: 'past the checks after 3 tries' });
    await failed.getByRole('button', { name: /Show the 2 problems/ }).click();
    await expect(failed.getByText(/Network\/external asset/)).toBeVisible();
    const buildingBadges = demo.locator('article').getByText('Building', { exact: true });
    await expect(buildingBadges).toHaveCount(1);
    await failed.getByRole('button', { name: /Try again/ }).click();
    await expect(buildingBadges).toHaveCount(2); // the failed card restarts as a new build

    const score = demo.locator('article', { hasText: 'Riya beat Rohan' });
    await expect(score.getByText('🔥 Riya beat Rohan: 1,240!')).toBeVisible();
  });

  test('▶ Play opens the sandboxed full-screen player; keyboard and tap reach the game; a score is posted', async ({ page, isMobile }) => {
    const { scores } = await mockPlay(page);
    await page.getByTestId('cards-demo').getByTestId('build-play').click();
    const player = page.getByTestId('game-player');
    await expect(player).toBeVisible();
    await expect(player.getByText('Sample Scooter Run')).toBeVisible();
    const iframe = player.locator('iframe');
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-pointer-lock');
    await expect(iframe).toHaveAttribute('allow', 'fullscreen; gamepad');
    // The overlay covers the whole viewport.
    const box = await player.boundingBox();
    const vp = page.viewportSize()!;
    expect(Math.round(box!.width)).toBe(vp.width);
    expect(Math.round(box!.height)).toBe(vp.height);

    const frame = await gameFrame(page);
    const scene = () => frame.evaluate(() => (window as unknown as { __crew: { state(): { scene: string; playerX: number } } }).__crew.state());
    expect((await scene()).scene).toBe('title');
    // A tap (phone) or Space (desktop, the iframe has focus) starts the run.
    if (isMobile) await iframe.tap({ position: { x: 40, y: 40 } });
    else await page.keyboard.press('Space');
    await expect.poll(async () => (await scene()).scene).toBe('playing');
    // Holding ArrowRight moves the player (desktop keyboard; the phone uses the on-screen button).
    if (!isMobile) {
      const before = (await scene()).playerX;
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(400);
      await page.keyboard.up('ArrowRight');
      expect((await scene()).playerX).toBeGreaterThan(before);
    }

    // The engine's score hook (as gameOver() posts it) reaches the player and is saved.
    await frame.evaluate(() => window.parent.postMessage({ type: 'crewarcade:score', score: 42, best: 42, time: 12.5 }, '*'));
    await expect(page.getByText("🏆 New best: 42. You're #1!")).toBeVisible();
    expect(scores).toEqual([{ gameId: 'gDemo', version: 1, score: 42, timeMs: 12_500 }]);
    await expect(player.getByText('Best 42 · #1')).toBeVisible();

    // Messages of the wrong shape are ignored (no second post).
    await frame.evaluate(() => window.parent.postMessage({ type: 'crewarcade:score', score: '9999', best: 0, time: 1 }, '*'));
    await page.waitForTimeout(300);
    expect(scores).toHaveLength(1);

    await player.getByRole('button', { name: 'Close the game' }).click();
    await expect(player).toHaveCount(0);
  });

  test('a version that is not available shows the error state', async ({ page }) => {
    await page.route('**/api/games/gDemo/versions/*/play', route => route.fulfill({ status: 404, json: { error: 'not_found', message: 'Version not found' } }));
    await page.getByTestId('cards-demo').locator('article', { hasText: 'Riya beat Rohan' }).getByRole('button', { name: '▶ Play' }).click();
    await expect(page.getByTestId('game-player').getByText('This version is not available to you.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('game-player')).toHaveCount(0);
  });
});

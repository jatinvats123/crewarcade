// Phase 3 end to end on live Nexconn with the server's FAKE agents:
// pitch -> plan -> approve -> game room -> Forge's Build card streams its steps -> Ready -> ▶ Play
// (sandboxed player, real /play with a signed URL and strict CSP) -> a score is posted -> the
// leaderboard shows it -> Glitch's ScoreCard appears in the room.
// Needs the server running with FAKE_AGENTS=1, a Nexconn dev app, a database, and webhooks (or the
// client relay) reaching the server:
//   E2E_CHAT=1 E2E_API_ORIGIN=http://127.0.0.1:8080 pnpm e2e --project desktop
import { expect, test, type Frame, type Page } from '@playwright/test';

const ENABLED = process.env.E2E_CHAT === '1';

test.describe('Forge: approve to play (FAKE_AGENTS=1)', () => {
  test.skip(
    !ENABLED,
    'Skipped: needs the server with FAKE_AGENTS=1, a Nexconn dev app with webhooks to the server, and a database (docs/STATUS.md). Then set E2E_CHAT=1 and E2E_API_ORIGIN.',
  );
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  const composer = (p: Page) => p.getByRole('textbox', { name: 'Message' });

  async function gameFrame(page: Page): Promise<Frame> {
    await expect.poll(() => page.frames().some(f => /\/play\/[a-z0-9-]+\/v\/\d+\?t=/.test(f.url())), { timeout: 30_000 }).toBe(true);
    const frame = page.frames().find(f => /\/play\/[a-z0-9-]+\/v\/\d+\?t=/.test(f.url()))!;
    await frame.waitForFunction(() => typeof (window as unknown as { __crew?: unknown }).__crew === 'object', undefined, { timeout: 20_000 });
    return frame;
  }

  test('approve -> BuildCard -> Play -> score -> leaderboard -> ScoreCard', async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto('/start');
    await page.getByLabel('Your name').fill('Asha');
    await page.getByRole('button', { name: 'Start playing' }).click();
    await page.waitForURL(/\/crews$/);
    await page.getByRole('button', { name: 'Start a solo crew' }).first().click();
    await page.waitForURL(/\/crews\/c[A-Za-z0-9]{16}$/);
    await expect(composer(page)).toBeEnabled({ timeout: 20_000 });

    await composer(page).fill('@pixel a chai cup on a scooter dodging potholes');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const plan = page.locator('article', { hasText: 'Checklist Glitch will test' }).last();
    await expect(plan).toBeVisible({ timeout: 45_000 });
    await plan.getByRole('button', { name: 'Approve' }).click();
    const roomLink = page.locator('article', { hasText: 'Game room: plan, builds, playtests' }).last();
    await expect(roomLink).toBeVisible({ timeout: 30_000 });
    await roomLink.getByRole('link', { name: /Open room/ }).click();
    await page.waitForURL(/\/rooms\/game[A-Za-z0-9]{16}$/);

    // Forge's Build card: progress lines, then Ready with ▶ Play.
    const build = page
      .locator('article', { hasText: /· v1/ })
      .filter({ has: page.getByRole('list', { name: 'Build progress' }) })
      .last();
    await expect(build).toBeVisible({ timeout: 60_000 });
    await expect(build.getByText('Reading the plan')).toBeVisible();
    await expect(build.getByText('Ready')).toBeVisible({ timeout: 90_000 });
    await expect(build.getByText('Saving v1')).toBeVisible();
    await expect(page.getByText('Test v1 against the acceptance list')).toBeVisible({ timeout: 20_000 });

    // ▶ Play: the real game from /play with a signed URL.
    await build.getByRole('button', { name: '▶ Play' }).click();
    const player = page.getByTestId('game-player');
    await expect(player.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-pointer-lock');
    const frame = await gameFrame(page);
    await page.keyboard.press('Space');
    await expect
      .poll(() => frame.evaluate(() => (window as unknown as { __crew: { state(): { scene: string } } }).__crew.state().scene), { timeout: 10_000 })
      .toBe('playing');
    // End the run the way the engine does: its score hook.
    await frame.evaluate(() => window.parent.postMessage({ type: 'crewarcade:score', score: 321, best: 321, time: 30 }, '*'));
    await expect(page.getByText("🏆 New best: 321. You're #1!")).toBeVisible({ timeout: 15_000 });
    await player.getByRole('button', { name: 'Close the game' }).click();

    // Leaderboard (desktop context panel tab) and Glitch's ScoreCard in the room.
    await page.getByRole('tab', { name: '🏆 Board' }).click();
    const board = page.getByTestId('leaderboard');
    await expect(board.getByText('321')).toBeVisible({ timeout: 15_000 });
    await expect(board.getByText('Asha')).toBeVisible();
    await expect(page.locator('article', { hasText: '🏆 Asha took #1: 321' })).toBeVisible({ timeout: 30_000 });
  });
});

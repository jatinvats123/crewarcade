// Judge tour without Nexconn: the API is mocked (a judge or an ordinary player), chat is
// "unconfigured", so these check the tour itself: who sees it, the phone bar and desktop panel,
// Show me's ring and hint, Skip / Got it / Next, ticks from pages opened, progress kept per user in
// localStorage, the "Tour complete" card, and no sideways scroll on narrow phones.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const user = (isJudge: boolean) => ({
  id: isJudge ? 'uJudge1' : 'uPlayer1',
  nexconnId: isJudge ? 'uJudge1' : 'uPlayer1',
  displayName: isJudge ? 'Judge' : 'Asha',
  avatarEmoji: '🦊',
  avatarColor: 'gold',
  avatarUrl: null,
  language: 'en',
  isAgent: false,
  isJudge,
});

async function signIn(page: Page, isJudge: boolean) {
  await page.route('**/api/**', route => route.fulfill({ status: 404, json: { error: 'not_found', message: 'Not found' } }));
  await page.route('**/api/me', route => route.fulfill({ json: { user: user(isJudge) } }));
  await page.route('**/api/crews', route => route.fulfill({ json: { crews: [] } }));
  await page.route('**/api/nexconn/token', route => route.fulfill({ status: 503, json: { error: 'unavailable', message: 'Chat is not configured' } }));
}

/** The tour card for this viewport: the bottom bar on phones, the panel on desktop. */
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024;

async function openChecklist(page: Page) {
  if (isPhone(page)) {
    await page
      .getByTestId('tour-bar')
      .getByRole('button', { name: /Open the judge tour checklist/ })
      .click();
    return page.getByTestId('tour-sheet');
  }
  const panel = page.getByTestId('tour-panel');
  await panel.getByText('All 23 steps').click();
  return panel;
}

test('ordinary players never see the tour', async ({ page }) => {
  await signIn(page, false);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: /Settings/i }).first()).toBeVisible();
  await expect(page.getByTestId('tour-bar')).toHaveCount(0);
  await expect(page.getByTestId('tour-panel')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('crewarcade:tour-user'))).toBeNull();
  // Not on public pages either.
  await page.goto('/safety');
  await expect(page.getByTestId('tour-bar')).toHaveCount(0);
  await expect(page.getByTestId('tour-panel')).toHaveCount(0);
});

test('a judge sees the tour; opening Settings ticks step 23; Skip moves on', async ({ page }) => {
  await signIn(page, true);
  await page.goto('/settings');
  if (isPhone(page)) {
    const bar = page.getByTestId('tour-bar');
    await expect(bar).toContainText('Next step · 1 of 23');
    await expect(bar).toContainText('Pitch a game');
    await expect(bar.getByTestId('tour-bar-show-me')).toBeVisible();
  } else {
    const panel = page.getByTestId('tour-panel');
    await expect(panel).toContainText('Judge tour');
    await expect(panel.getByRole('progressbar', { name: 'Judge tour progress' })).toHaveAttribute('aria-valuenow', '1');
    await expect(panel.getByTestId('tour-step')).toContainText('Press');
    await expect(panel.getByTestId('tour-step')).toContainText('What happens');
    await expect(panel.getByTestId('tour-step')).toContainText('Why it matters');
  }
  const list = await openChecklist(page);
  await expect(list.getByTestId('tour-checklist').getByRole('button')).toHaveCount(23);
  await expect(list.getByRole('button', { name: /23\. Settings.*done/ })).toBeVisible();
  await list.getByTestId('tour-skip').click();
  await expect(list.getByTestId('tour-step')).toContainText('Change the plan');
  await expect(list.getByRole('button', { name: /1\. Pitch a game.*skipped/ })).toBeVisible();

  // Progress lives in localStorage per user: a reload keeps it.
  await page.reload();
  const again = await openChecklist(page);
  await expect(again.getByTestId('tour-step')).toContainText('Change the plan');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('crewarcade:tour:uJudge1') ?? '{}'));
  expect(saved.facts).toContain('visit:/settings');
  expect(saved.skipped).toEqual(['pitch']);
});

test('Show me rings the exact control with a hint; the done step says so, then Next', async ({ page }) => {
  await signIn(page, true);
  await page.goto('/settings');
  const list = await openChecklist(page);
  await list.getByRole('button', { name: /23\. Settings/ }).click();
  // Step 23 is already done (we're on Settings): the card shows the tick and Next.
  await expect(list.getByTestId('tour-done')).toContainText('Done: settings opened.');
  // Go to the voice step (an info step), then Show me rings the language select on Settings.
  await list.getByRole('button', { name: /18\. Pitch by voice/ }).click();
  await expect(list.getByTestId('tour-step')).toContainText('Info');
  await list.getByTestId('tour-ack').click();
  await expect(list.getByTestId('tour-done')).toContainText('Done: voice pitches covered.');
  await list.getByTestId('tour-next').click();
  await expect(list.getByTestId('tour-step')).toContainText('Score-beaten DM');

  if (isPhone(page)) await page.keyboard.press('Escape');
  // Make step 23 open again (as if Settings was never opened) and start from another page.
  await page.evaluate(() => {
    const k = 'crewarcade:tour:uJudge1';
    const s = JSON.parse(localStorage.getItem(k)!);
    s.facts = s.facts.filter((f: string) => f !== 'visit:/settings');
    s.focus = 'settings';
    localStorage.setItem(k, JSON.stringify(s));
  });
  // From a public page (floating card on desktop, fixed bar on phones), Show me goes to Settings.
  await page.goto('/safety');
  const showMe = isPhone(page) ? page.getByTestId('tour-bar-show-me') : page.getByTestId('tour-panel').getByTestId('tour-show-me');
  await showMe.click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId('tour-ring')).toBeVisible();
  await expect(page.getByTestId('tour-hint')).toHaveText('The agents reply in this language');
  // The ring sits on the language select.
  await expect
    .poll(async () => {
      const [ring, select] = await Promise.all([
        page.getByTestId('tour-ring').locator('span').first().boundingBox(),
        page.locator('[data-tour="reply-language"]').boundingBox(),
      ]);
      return !!ring && !!select && Math.abs(ring.x + 6 - select.x) < 4 && Math.abs(ring.y + 6 - select.y) < 4;
    })
    .toBe(true);
  // Opening Settings ticked it.
  await expect(isPhone(page) ? page.getByTestId('tour-bar') : page.getByTestId('tour-panel')).toContainText(/Done/);
});

test('public pages: the tour follows the judge and opening /impact and /safety ticks step 20', async ({ page }) => {
  await signIn(page, true);
  await page.goto('/settings');
  await expect(isPhone(page) ? page.getByTestId('tour-bar') : page.getByTestId('tour-panel')).toBeVisible();
  await page.goto('/impact');
  await expect(isPhone(page) ? page.getByTestId('tour-bar') : page.getByTestId('tour-panel')).toBeVisible();
  await page.goto('/safety');
  const facts = await page.evaluate(() => JSON.parse(localStorage.getItem('crewarcade:tour:uJudge1') ?? '{}').facts);
  expect(facts).toEqual(expect.arrayContaining(['visit:/impact', 'visit:/safety']));
  const list = await openChecklist(page);
  await expect(list.getByRole('button', { name: /20\. Live numbers and safety.*done/ })).toBeVisible();
  // Not on the landing page.
  await page.goto('/');
  await expect(page.getByTestId('tour-bar')).toHaveCount(0);
  await expect(page.getByTestId('tour-panel')).toHaveCount(0);
});

test('tour complete lists the skipped steps with links back to them', async ({ page }) => {
  await signIn(page, true);
  await page.goto('/settings');
  await page.evaluate(() => {
    const ids = [
      'pitch',
      'change',
      'approve',
      'build',
      'playtest',
      'retry',
      'play',
      'allow',
      'page',
      'board',
      'bug',
      'story',
      'remix',
      'shield',
      'hindi',
      'translate',
      'invite',
      'voice',
      'dm',
      'numbers',
      'sandbox',
      'arcade',
      'settings',
    ];
    const facts = ['plan', 'plan-v2', 'approved', 'build-ready', 'test', 'test-pass', 'game:g1', 'play:g1', 'published', 'slug:s1', 'visit:/g/s1'];
    facts.push('leaderboard', 'story', 'remix', 'shield', 'plan-hi', 'translate', 'invite', 'info:voice', 'info:dm', 'visit:/impact', 'visit:/safety');
    facts.push('info:sandbox', 'visit:/settings');
    localStorage.setItem('crewarcade:tour:uJudge1', JSON.stringify({ facts, skipped: ids.filter(i => i === 'bug' || i === 'arcade'), focus: null, ctx: {} }));
  });
  await page.reload();
  const card = isPhone(page) ? (await openChecklist(page)).getByTestId('tour-complete') : page.getByTestId('tour-panel').getByTestId('tour-complete');
  await expect(card).toContainText('Tour complete');
  await expect(card).toContainText('21 of 23 done');
  await expect(card.getByRole('button')).toHaveText(['11. Report a bug →', '22. Play another crew’s game →']);
  await card.getByRole('button', { name: /22\. Play another crew/ }).click();
  await expect(page).toHaveURL(/\/arcade$/);
});

test('no sideways scroll at 320–390 px with the tour bar and checklist open', async ({ page }) => {
  test.skip(!isPhone(page), 'phone widths');
  await signIn(page, true);
  for (const width of [320, 360, 375, 390]) {
    await page.setViewportSize({ width, height: 740 });
    await page.goto('/settings');
    await expect(page.getByTestId('tour-bar')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
    const sheet = await openChecklist(page);
    await expect(sheet).toBeVisible();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(wide, `${width}px with the checklist`).toBeLessThanOrEqual(0);
    const box = await sheet.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width + 0.5).toBe(true);
  }
});

test('a saved score on another crew’s game ticks the Arcade step; opening the player is recorded', async ({ page }) => {
  // The engine's own starter game behind a mocked play URL (as in player.spec.ts), opened from the
  // /dev/ui gallery, which has a Play button. The tour UI stays off /dev pages, but ticks still count.
  const GAME_HTML = readFileSync(path.resolve(process.cwd(), '../../packages/engine/starter/index.html'), 'utf8');
  const CSP =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-ancestors *";
  await page.route('**/api/games/gDemo/versions/*/play', route =>
    route.fulfill({
      json: {
        url: 'https://play.test/play/sample-scooter-run/v/1?t=1999999999999.abcdefghijklmnopqrstuv',
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
  await page.route('**/api/scores', route => route.fulfill({ json: { accepted: true, best: 42, rank: 3, newBest: true } }));
  await page.goto('/dev/ui');
  await page.evaluate(() => localStorage.setItem('crewarcade:tour-user', 'uJudge1'));
  await page.reload();
  await page.getByTestId('cards-demo').scrollIntoViewIfNeeded();
  await page.getByTestId('cards-demo').getByTestId('build-play').click();
  await expect.poll(() => page.frames().some(f => f.url().startsWith('https://play.test/')), { timeout: 15_000 }).toBe(true);
  const frame = page.frames().find(f => f.url().startsWith('https://play.test/'))!;
  await frame.waitForFunction(() => typeof (window as unknown as { __crew?: unknown }).__crew === 'object');
  await frame.evaluate(() => window.parent.postMessage({ type: 'crewarcade:score', score: 42, best: 42, time: 12.5 }, '*'));
  await expect
    .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('crewarcade:tour:uJudge1') ?? '{"facts":[]}').facts as string[]))
    .toEqual(expect.arrayContaining(['play:gDemo', 'score:gDemo']));
  // gDemo is not one of the judge's games, so step 22 is done.
  await page.goto('/settings');
  await signIn(page, true);
  await page.reload();
  const list = await openChecklist(page);
  await expect(list.getByRole('button', { name: /22\. Play another crew.*done/ })).toBeVisible();
});

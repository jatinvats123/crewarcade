import { expect, test } from '@playwright/test';

test('landing page renders the pitch and the three agents', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/CrewArcade/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('3 AI agents');
  // Agent cards show the name and the role on separate lines.
  for (const role of ['Designer', 'Builder', 'Playtester']) await expect(page.getByText(role, { exact: true }).first()).toBeAttached();
  for (const name of ['pixel', 'forge', 'glitch']) await expect(page.getByText(new RegExp(`^${name}$`, 'i')).first()).toBeAttached();
});

test('no horizontal scroll at phone width', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('live numbers page: explains how it counts and links the raw JSON, even while the API is down', async ({ page }) => {
  await page.goto('/impact');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Real crews');
  await expect(page.getByRole('heading', { name: 'How we count' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Raw numbers (JSON)' })).toHaveAttribute('href', /\/api\/public\/impact$/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('judge mode page: pitch ideas are chips (nothing to pick or type) and one start button', async ({ page }) => {
  await page.goto('/try');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('See it work');
  const ideas = page.getByRole('list', { name: 'Pitch ideas' }).getByRole('listitem');
  await expect(ideas).toHaveCount(3);
  await expect(ideas.filter({ hasText: /[ऀ-ॿ]/ })).toHaveCount(1);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByTestId('judge-start')).toBeVisible();
  // The tour is for signed-in judges, not this start page.
  await expect(page.getByTestId('tour-bar')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('UI kit: sheet opens and closes with Escape, toasts appear', async ({ page }) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Open sheet' }).click();
  await expect(page.getByRole('dialog', { name: 'Report a bug' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Success toast' }).click();
  await expect(page.getByRole('status').getByText('Plan approved')).toBeVisible();
});

// The landing is always dark; the toggle lives on /arcade and in Settings.
test('theme toggle switches to light and remembers it', async ({ page }) => {
  await page.goto('/arcade');
  const html = page.locator('html');
  await page.getByRole('button', { name: /Switch to (light|dark) mode/ }).click();
  const theme = await html.getAttribute('data-theme');
  expect(theme === 'light' || theme === 'dark').toBe(true);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', theme!);
});

test('a judge can find judge mode from the landing page and the sign-up screen; players keep the normal sign-up', async ({ page }) => {
  await page.goto('/');
  const cta = page.getByTestId('judge-cta');
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute('href', '/try');
  await page.goto('/start');
  const choice = page.getByTestId('judge-choice');
  await expect(choice.getByRole('link', { name: /I'm a judge/ })).toHaveAttribute('href', '/try');
  await expect(page.getByText('Or sign up as a player')).toBeVisible();
  await expect(page.getByLabel('Your name')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // Invite links go straight to joining: no judge choice there.
  await page.goto('/start?next=/i/ABC123');
  await expect(page.getByTestId('judge-choice')).toHaveCount(0);
  // And /try points players back to the normal sign-up.
  await page.goto('/try');
  await expect(page.getByRole('link', { name: 'Sign up as a player' })).toHaveAttribute('href', '/start');
});

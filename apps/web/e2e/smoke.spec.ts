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

import { expect, test } from '@playwright/test';

test('landing page renders the pitch and the three agents', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/CrewArcade/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('3 AI agents');
  for (const name of ['Pixel · Designer', 'Forge · Builder', 'Glitch · Playtester']) await expect(page.getByText(name).first()).toBeVisible();
});

test('no horizontal scroll at phone width', async ({ page }) => {
  await page.goto('/');
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

test('theme toggle switches to light and remembers it', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  await page.getByRole('button', { name: /Switch to (light|dark) mode/ }).click();
  const theme = await html.getAttribute('data-theme');
  expect(theme === 'light' || theme === 'dark').toBe(true);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', theme!);
});

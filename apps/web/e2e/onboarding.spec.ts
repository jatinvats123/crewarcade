// Onboarding UI that works without the API (validation runs in the browser with the shared schema).
import { expect, test } from '@playwright/test';

test('landing links to onboarding', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Start a crew' }).first().click();
  await expect(page).toHaveURL(/\/start/);
  await expect(page.getByRole('heading', { name: 'What should your crew call you?' })).toBeVisible();
});

test('onboarding: one screen, name is validated, 8 players shown (24 on demand), one preselected', async ({ page }) => {
  await page.goto('/start');
  const name = page.getByLabel('Your name');
  await expect(name).toBeVisible();
  const players = page.getByRole('radiogroup', { name: 'Your player' }).getByRole('radio');
  await expect(players).toHaveCount(8);
  await expect(page.getByRole('radiogroup', { name: 'Your player' }).getByRole('radio', { checked: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Show 16 more players' }).click();
  await expect(players).toHaveCount(24);
  await expect(page.getByLabel('They reply in')).toBeVisible();
  await name.fill('R');
  await page.getByRole('button', { name: 'Start playing' }).click();
  await expect(page.getByText('Use at least 2 characters')).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
  await name.fill('x'.repeat(30));
  await expect(name).toHaveValue('x'.repeat(24)); // maxLength
});

test('onboarding picks the chat language from the browser', async ({ browser }) => {
  const page = await (await browser.newContext({ locale: 'hi-IN' })).newPage();
  await page.goto('/start');
  await expect(page.getByLabel('They reply in')).toHaveValue('hi');
});

test('onboarding has no horizontal scroll and 44px targets', async ({ page }) => {
  await page.goto('/start');
  await expect(page.getByLabel('Your name')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const small = await page.$$eval('button, a, input, select', els =>
    els
      .filter(e => (e as HTMLElement).offsetParent !== null)
      .map(e => e.getBoundingClientRect())
      .filter(r => r.height < 44 && r.width > 0)
      .map(r => `${r.width}x${r.height}`),
  );
  expect(small).toEqual([]);
});

test('invalid ?next= targets are ignored', async ({ page }) => {
  await page.goto('/start?next=//evil.example');
  await expect(page.getByLabel('Your name')).toBeVisible();
});

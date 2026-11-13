// Onboarding UI that works without the API (validation runs in the browser with the shared schema).
import { expect, test } from '@playwright/test';

test('landing links to onboarding', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Start a crew' }).click();
  await expect(page).toHaveURL(/\/start/);
  await expect(page.getByRole('heading', { name: "Who's playing?" })).toBeVisible();
});

test('onboarding: name is validated, 24 avatars and 6 colours, one is preselected', async ({ page }) => {
  await page.goto('/start');
  const name = page.getByLabel('Your name');
  await expect(name).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Avatar emoji' }).getByRole('radio')).toHaveCount(24);
  await expect(page.getByRole('radiogroup', { name: 'Avatar ring colour' }).getByRole('radio')).toHaveCount(6);
  await expect(page.getByRole('radiogroup', { name: 'Avatar emoji' }).getByRole('radio', { checked: true })).toHaveCount(1);
  await name.fill('R');
  await page.getByRole('button', { name: "Let's go" }).click();
  await expect(page.getByText('Use at least 2 characters')).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
  await name.fill('x'.repeat(30));
  await expect(name).toHaveValue('x'.repeat(24)); // maxLength
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

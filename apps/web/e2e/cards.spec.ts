// Phase 2 UI without Nexconn: the card renderers, the streamed Markdown reply and the Agent Status
// Strip on the /dev/ui gallery (sample data with fake actions that answer like the server).
import { expect, test } from '@playwright/test';

test.describe('cards, stream and agent strip (gallery)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByTestId('cards-demo').scrollIntoViewIfNeeded();
  });

  test('the status strip shows each agent with a live chip', async ({ page }) => {
    const strip = page.getByTestId('cards-demo').getByRole('status', { name: 'What the agents are doing' });
    await expect(strip.getByRole('button', { name: /Pixel · Designer: Thinking/ })).toBeVisible();
    await expect(strip.getByRole('button', { name: /Forge · Builder: Building/ })).toContainText(/\d+s/);
    await expect(strip.getByRole('button', { name: /Glitch · Playtester: Testing/ })).toContainText('12/18');
    await strip.getByRole('button', { name: /Pixel · Designer/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Pixel · Designer' });
    await expect(sheet.getByText('Last 5 actions in this crew')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('a streamed reply types out as Markdown, with a caret until complete', async ({ page }) => {
    const demo = page.getByTestId('cards-demo');
    const bubble = demo.locator('[aria-busy]').first();
    await expect(demo.locator('em', { hasText: 'Sample Scooter Run' })).toBeVisible({ timeout: 10_000 });
    await expect(demo.locator('strong', { hasText: 'potholes' })).toBeVisible({ timeout: 10_000 });
    await expect(bubble).toHaveCount(0, { timeout: 10_000 }); // aria-busy goes away when the stream completes
  });

  test('plan card: vote instantly, approve, then link to the game room', async ({ page }) => {
    const card = page.getByTestId('cards-demo').locator('article', { hasText: 'Sample Scooter Run' }).first();
    await expect(card.getByText('AI-generated')).toBeVisible();
    await expect(card.getByText('Checklist Glitch will test')).toBeVisible();
    const yes = card.getByRole('button', { name: /Vote yes/ });
    await expect(yes).toHaveAccessibleName('Vote yes, 1 so far');
    await yes.click();
    await expect(yes).toHaveAccessibleName('Vote yes, 2 so far');
    await expect(yes).toHaveAttribute('aria-pressed', 'true');
    await card.getByRole('button', { name: /Vote no/ }).click();
    await expect(card.getByRole('button', { name: /Vote no/ })).toHaveAccessibleName('Vote no, 1 so far');
    await expect(yes).toHaveAccessibleName('Vote yes, 1 so far');

    await card.getByRole('button', { name: 'Full plan (+1 checks)' }).click();
    await expect(card.getByText('Win / lose')).toBeVisible();

    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(card.getByText('Approved by You')).toBeVisible();
    await expect(card.getByRole('link', { name: /Open game room/ })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });

  test('handoff and room link cards render; Change opens a sheet', async ({ page }) => {
    const demo = page.getByTestId('cards-demo');
    await expect(demo.getByText('Build v1 from this plan')).toBeVisible();
    await expect(demo.getByText('Forge will start soon')).toBeVisible();
    await expect(demo.getByRole('link', { name: /Open room/ })).toBeVisible();
    await demo
      .getByRole('button', { name: /Change/ })
      .first()
      .click();
    const sheet = page.getByRole('dialog', { name: /Change Sample Scooter Run/ });
    await sheet.getByRole('textbox').fill('make it faster');
    await sheet.getByRole('button', { name: 'Send to Pixel' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(demo.getByText('Change requested · Pixel is revising')).toBeVisible();
  });

  test('no horizontal scroll with cards on the page', async ({ page }) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('cards in a chat row stay inside the screen, even with long unbroken text', async ({ page }) => {
    // The real chat row (avatar + name + bubble) with a FAIL card whose details are long JSON.
    await expect(page.getByTestId('cards-demo').getByText(/did not match the schema/)).toBeVisible();
    const sticking = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      return [...document.querySelectorAll('[data-testid="cards-demo"] article')]
        .map(a => a.getBoundingClientRect())
        .filter(r => r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5))
        .map(r => `${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`);
    });
    expect(sticking).toEqual([]);
  });
});

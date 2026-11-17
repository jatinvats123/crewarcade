// Phase 5 (FAKE, no Nexconn): a bug report becomes Glitch's BugCard, which turns "Reproduced" with
// the BUG check, shows Forge's hotfix version, and then the hotfix publish card appears with the bug
// hunter's credit; Allow publishes it. The /dev/ui demo plays the server's card updates.
import { expect, test } from '@playwright/test';

test('bug report -> BugCard reproduced -> hotfix card -> Allow', async ({ page }) => {
  await page.goto('/dev/ui');
  const demo = page.getByTestId('cards-demo');
  await demo.getByTestId('demo-bug').scrollIntoViewIfNeeded();
  await demo.getByTestId('demo-bug').click();

  const bug = demo.locator('article', { hasText: 'Bug from Riya' });
  await expect(bug).toBeVisible();
  await expect(bug.getByText('Holding right against the wall, the potholes never hit me')).toBeVisible();
  await expect(bug.getByText('Reproduced', { exact: true })).toBeVisible();
  await expect(bug.getByText(/Forge's hotfix v2 is being built/)).toBeVisible();

  const hotfix = demo.locator('article', { hasText: 'Hotfix v2: publish?' });
  await expect(hotfix).toBeVisible();
  await expect(hotfix.getByTestId('hotfix-info')).toContainText('Bug hunter: Riya');
  await hotfix.getByTestId('publish-allow').click();
  await expect(demo.locator('article', { hasText: 'Hotfix v2 is live' })).toBeVisible();
});

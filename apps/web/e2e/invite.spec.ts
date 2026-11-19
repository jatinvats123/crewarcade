// Invite screen (/i/<code>) with the API mocked: the crew is the headline, a visitor signs up inline
// on the same calm form as /start, and dead or full invites say so plainly.
import { expect, test, type Page } from '@playwright/test';

const CODE = 'ABCDEFGH';
const PREVIEW = {
  crewId: 'cDemoCrew0000001',
  name: 'Friday Night Crew',
  memberCount: 5,
  members: [
    { displayName: 'Riya', avatarEmoji: '🐼', avatarColor: 'gold', avatarUrl: null, isAgent: false, agent: null },
    { displayName: 'Pixel · Designer', avatarEmoji: '🎨', avatarColor: 'violet', avatarUrl: null, isAgent: true, agent: 'pixel' },
    { displayName: 'Forge · Builder', avatarEmoji: '🔨', avatarColor: 'amber', avatarUrl: null, isAgent: true, agent: 'forge' },
    { displayName: 'Glitch · Playtester', avatarEmoji: '🔍', avatarColor: 'cyan', avatarUrl: null, isAgent: true, agent: 'glitch' },
  ],
  full: false,
  alreadyMember: false,
};

async function mock(page: Page, invite: object | null) {
  await page.route('**/api/me', route => route.fulfill({ status: 401, json: { error: 'unauthorized', message: 'Sign in first' } }));
  await page.route(`**/api/invites/${CODE}`, route =>
    invite ? route.fulfill({ json: { invite } }) : route.fulfill({ status: 404, json: { error: 'not_found', message: 'Invite not found' } }),
  );
}

test('invite: crew name is the headline, members show, the visitor joins on the calm form', async ({ page }) => {
  await mock(page, PREVIEW);
  await page.goto(`/i/${CODE}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Friday Night Crew' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Members' }).getByRole('listitem')).toHaveCount(5); // 4 faces + "+1"
  await expect(page.getByText('5 members, including Pixel, Forge and Glitch')).toBeVisible();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Your player' }).getByRole('radio')).toHaveCount(8);
  await page.getByRole('button', { name: 'Join crew' }).click();
  await expect(page.getByText('Use at least 2 characters')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('invite: a dead link says so and offers a retry', async ({ page }) => {
  await mock(page, null);
  await page.goto(`/i/${CODE}`);
  await expect(page.getByRole('heading', { name: "Can't open this invite" })).toBeVisible();
  await expect(page.getByText('This invite link is not valid any more')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('invite: a full crew hides the form', async ({ page }) => {
  await mock(page, { ...PREVIEW, memberCount: 30, full: true });
  await page.goto(`/i/${CODE}`);
  await expect(page.getByRole('heading', { name: 'This crew is full' })).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: '+26' })).toBeVisible();
});

// Two real users, two browser contexts, real Nexconn (dev app): sign in -> create crew -> invite ->
// join -> exchange messages -> typing indicator seen -> read receipt shown.
// Needs: the server running with a Nexconn dev app's keys and a database (docs/STATUS.md), then:
//   E2E_CHAT=1 E2E_API_ORIGIN=http://127.0.0.1:8080 pnpm e2e --project desktop
import { expect, test, type Browser, type Page } from '@playwright/test';

const ENABLED = process.env.E2E_CHAT === '1';

test.describe('two-user chat on Nexconn', () => {
  test.skip(
    !ENABLED,
    'Skipped: needs the CrewArcade server running with a Nexconn dev app and a database (docs/STATUS.md, "Run the two-user chat e2e"). Then set E2E_CHAT=1 and E2E_API_ORIGIN (default http://127.0.0.1:8080).',
  );
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  async function signIn(browser: Browser, name: string, path = '/start'): Promise<Page> {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(path);
    await page.getByLabel('Your name').fill(name);
    await page.getByRole('button', { name: path.startsWith('/i/') ? 'Join crew' : "Let's go" }).click();
    await page.waitForURL(path.startsWith('/i/') ? /\/crews\/c[A-Za-z0-9]{16}$/ : /\/crews$/);
    test.info().annotations.push({ type: 'sign-in', description: `${name}: ${Date.now() - t0} ms` });
    return page;
  }

  const composer = (p: Page) => p.getByRole('textbox', { name: 'Message' });
  const send = async (p: Page, text: string) => {
    await composer(p).fill(text);
    await p.getByRole('button', { name: 'Send', exact: true }).click();
  };

  test('sign in, create, invite, join, chat, typing, receipts', async ({ browser }) => {
    const asha = await signIn(browser, 'Asha');
    await asha.getByRole('button', { name: 'Name a crew and invite friends' }).click();
    await asha.getByLabel('Crew name').fill(`E2E crew ${Date.now() % 100000}`);
    await asha.getByRole('button', { name: 'Create crew' }).click();
    await asha.waitForURL(/\/crews\/c[A-Za-z0-9]{16}$/);

    // Pixel's welcome arrives through Nexconn: the agents are members from day one.
    await expect(asha.getByText("Hi crew! I'm Pixel", { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(composer(asha)).toBeEnabled({ timeout: 20_000 });

    await asha.getByRole('button', { name: 'Crew info', exact: true }).click();
    const link = await asha.getByLabel('Invite link').inputValue();
    expect(link).toMatch(/\/i\/[2-9A-HJ-NP-Z]{8}$/);
    await asha.keyboard.press('Escape');

    const riya = await signIn(browser, 'Riya', new URL(link).pathname);
    await expect(composer(riya)).toBeEnabled({ timeout: 20_000 });
    await expect(asha.getByText('Riya joined the crew')).toBeVisible({ timeout: 20_000 });

    await send(asha, 'hello from Asha @pixel');
    await expect(riya.getByText('hello from Asha')).toBeVisible({ timeout: 15_000 });
    await expect(riya.locator('span', { hasText: '@pixel' }).first()).toBeVisible();

    // Riya types: Asha sees the indicator (CA:Typing status message).
    await composer(riya).pressSequentially('typing…', { delay: 30 });
    await expect(asha.getByText('Riya is typing…')).toBeVisible({ timeout: 10_000 });
    await riya.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(asha.getByText('typing…', { exact: true })).toBeVisible({ timeout: 15_000 });

    // Riya had Asha's message on screen: Asha's message shows "Seen by 1".
    await expect(asha.getByRole('button', { name: /Seen by 1/ })).toBeVisible({ timeout: 20_000 });
    await asha.getByRole('button', { name: /Seen by 1/ }).click();
    await expect(asha.getByRole('dialog', { name: 'Seen by' }).getByText('Riya')).toBeVisible({ timeout: 10_000 });

    // Presence: Asha sees Riya online.
    await asha.keyboard.press('Escape');
    await expect(asha.getByText(/2 online/)).toBeVisible({ timeout: 20_000 });
  });
});

// Phase 2 end to end with two real users on Nexconn and the server's fake agents:
// pitch -> streamed reply -> PlanCard -> two users vote -> approver approves -> game room with
// RoomLink + HandoffCard -> the Story (ledger) shows the steps.
// Needs the CrewArcade server running with FAKE_AGENTS=1, a Nexconn dev app, a database, and the
// webhook reaching the server (the router runs on message:send; docs/STATUS.md "Run the Pixel e2e"):
//   E2E_CHAT=1 E2E_API_ORIGIN=http://127.0.0.1:8080 pnpm e2e --project desktop
import { expect, test, type Browser, type Page } from '@playwright/test';

const ENABLED = process.env.E2E_CHAT === '1';

test.describe('Pixel: pitch to game room (FAKE_AGENTS=1)', () => {
  test.skip(
    !ENABLED,
    'Skipped: needs the server with FAKE_AGENTS=1, a Nexconn dev app with webhooks to the server, and a database (docs/STATUS.md, "Run the Pixel e2e"). Then set E2E_CHAT=1 and E2E_API_ORIGIN.',
  );
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  async function signIn(browser: Browser, name: string, path = '/start'): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    await page.goto(path);
    await page.getByLabel('Your name').fill(name);
    await page.getByRole('button', { name: path.startsWith('/i/') ? 'Join crew' : 'Start playing' }).click();
    await page.waitForURL(path.startsWith('/i/') ? /\/crews\/c[A-Za-z0-9]{16}$/ : /\/crews$/);
    return page;
  }
  const composer = (p: Page) => p.getByRole('textbox', { name: 'Message' });

  test('pitch, vote, approve, game room, story', async ({ browser }) => {
    const asha = await signIn(browser, 'Asha');
    await asha.getByRole('button', { name: 'Name a crew and invite friends' }).click();
    await asha.getByLabel('Crew name').fill(`Pixel e2e ${Date.now() % 100000}`);
    await asha.getByRole('button', { name: 'Create crew' }).click();
    await asha.waitForURL(/\/crews\/c[A-Za-z0-9]{16}$/);
    await expect(composer(asha)).toBeEnabled({ timeout: 20_000 });
    await asha.getByRole('button', { name: 'Crew info', exact: true }).click();
    const link = await asha.getByLabel('Invite link').inputValue();
    await asha.keyboard.press('Escape');
    const riya = await signIn(browser, 'Riya', new URL(link).pathname);
    await expect(composer(riya)).toBeEnabled({ timeout: 20_000 });

    // The pitch: Pixel thinks, streams a short reply, then posts the plan.
    await composer(asha).fill('@pixel a chai cup on a scooter dodging potholes');
    await asha.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(asha.getByRole('button', { name: /Pixel · Designer: (Thinking|Designing)/ })).toBeVisible({ timeout: 20_000 });
    await expect(asha.getByText(/Ooh, I love this! Planning/)).toBeVisible({ timeout: 30_000 });
    const planOn = (p: Page) => p.locator('article', { hasText: 'Checklist Glitch will test' }).last();
    await expect(planOn(asha)).toBeVisible({ timeout: 30_000 });
    await expect(planOn(riya)).toBeVisible({ timeout: 30_000 });
    await expect(planOn(asha).getByText('AI-generated')).toBeVisible();

    // Two people vote; both screens see 2 👍.
    await planOn(riya)
      .getByRole('button', { name: /Vote yes/ })
      .click();
    await planOn(asha)
      .getByRole('button', { name: /Vote yes/ })
      .click();
    await expect(planOn(riya).getByRole('button', { name: /Vote yes/ })).toHaveAccessibleName('Vote yes, 2 so far', { timeout: 15_000 });
    await expect(planOn(asha).getByRole('button', { name: /Vote yes/ })).toHaveAccessibleName('Vote yes, 2 so far', { timeout: 15_000 });
    // Riya is a member, not an approver.
    await expect(planOn(riya).getByRole('button', { name: 'Approve' })).toHaveCount(0);

    await planOn(asha).getByRole('button', { name: 'Approve' }).click();
    await expect(planOn(riya).getByText('Approved by Asha')).toBeVisible({ timeout: 20_000 });
    const roomLink = riya.locator('article', { hasText: 'Game room: plan, builds, playtests' }).last();
    await expect(roomLink).toBeVisible({ timeout: 20_000 });
    await roomLink.getByRole('link', { name: /Open room/ }).click();
    await riya.waitForURL(/\/rooms\/game[A-Za-z0-9]{16}$/);
    await expect(riya.getByText('Build v1 from this plan')).toBeVisible({ timeout: 20_000 });
    await expect(riya.getByText('Forge will start soon')).toBeVisible();

    // The Story (desktop context panel) lists the steps.
    const story = riya.getByRole('list', { name: 'How this game was made' });
    await expect(story).toBeVisible({ timeout: 15_000 });
    for (const step of ['Planned the game', 'Voted', 'Approved the plan', 'Opened the game room', 'Handed off', 'Queued a build'])
      await expect(story.getByText(step).first()).toBeVisible();
  });
});

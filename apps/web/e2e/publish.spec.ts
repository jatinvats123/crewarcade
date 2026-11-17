// Phase 4 (FAKE, no Nexconn): Glitch's Test card shows PASS with one row per acceptance item, the
// publish request's Allow (owner/approver) turns it into the published card with the /g link, and
// /g/<slug> plays the published version in the sandboxed player.
// The public page is rendered on the Next server, which fetches the CrewArcade API at
// NEXT_PUBLIC_API_ORIGIN (default http://127.0.0.1:8080): this spec serves a mock of exactly that
// one route there, so it runs in the desktop project only (one port) and skips when E2E_CHAT runs a
// real server on it.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const SLUG = 'sample-scooter-run';
const GAME_HTML = readFileSync(path.resolve(process.cwd(), '../../packages/engine/starter/index.html'), 'utf8');
const API = new URL(process.env.E2E_API_ORIGIN ?? 'http://127.0.0.1:8080');
const PLAY_URL = `${API.origin}/play/${SLUG}/v/2`;
const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-ancestors *";

const PUBLIC_GAME = {
  id: 'gPub',
  slug: SLUG,
  title: 'Sample Scooter Run',
  pitch: 'A scooter dodging potholes on a rainy road.',
  status: 'published',
  language: 'en',
  emoji: '🛵',
  colors: ['#7c5cff', '#ffb547'],
  publishedVersion: 2,
  screenshotUrl: null,
  playUrl: PLAY_URL,
  orientation: 'any',
  crew: { name: 'Demo Crew', members: [{ name: 'Asha', avatarEmoji: '🦊', avatarColor: '#7c5cff' }] },
  remixOf: null,
  remixes: [],
  versions: [],
  createdAt: '2026-11-17T00:00:00.000Z',
};

let server: http.Server | null = null;

test.describe('Test card PASS -> Allow -> public page', () => {
  test.skip(process.env.E2E_CHAT === '1', 'E2E_CHAT runs a real server on the API port');
  test.beforeEach(() => test.skip(test.info().project.name !== 'desktop', 'one mock API port: desktop project only'));

  test.beforeAll(async ({ browserName: _b }, info) => {
    if (info.project.name !== 'desktop') return;
    server = http.createServer((req, res) => {
      if (req.url === `/api/public/games/${SLUG}`) return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(PUBLIC_GAME));
      if (req.url?.startsWith(`/play/${SLUG}/v/2`))
        return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }).end(GAME_HTML);
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(Number(API.port), API.hostname, resolve);
    });
  });
  test.afterAll(async () => {
    await new Promise<void>(r => (server ? server.close(() => r()) : r()));
  });

  test('PASS card rows, Allow publishes, /g plays the published version', async ({ page }) => {
    await page.goto('/dev/ui');
    const demo = page.getByTestId('cards-demo');
    await demo.scrollIntoViewIfNeeded();

    const pass = demo.locator('article', { hasText: 'Playtest v1: PASS' });
    await expect(pass.getByText('18/18 checks · 58 fps')).toBeVisible();
    await expect(pass.getByTestId('test-items').getByRole('listitem')).toHaveCount(3);
    await expect(pass.getByTestId('test-fix')).toHaveCount(0);
    const fail = demo.locator('article', { hasText: 'Playtest v2: FAIL' });
    await expect(fail.getByText('Automatic fixes used up: your call')).toBeVisible();
    await expect(fail.getByTestId('test-fix')).toHaveText(/Try again/);

    const pub = demo.locator('article', { hasText: 'Publish Sample Scooter Run v1?' });
    await expect(pub.getByText('Waiting for an approver')).toBeVisible();
    await pub.getByTestId('publish-allow').click();
    const live = demo.locator('article', { hasText: 'Sample Scooter Run is live' });
    await expect(live.getByText('Allowed by You')).toBeVisible();
    await expect(live.getByTestId('publish-link')).toHaveAttribute('href', `https://crewarcade.test/g/${SLUG}`);

    // The public page plays the published version (v2) in the sandboxed player.
    await page.route('**/api/games/gPub/versions/2/play', route =>
      route.fulfill({
        json: { url: PLAY_URL, expiresAt: Date.now() + 60_000, gameId: 'gPub', slug: SLUG, title: 'Sample Scooter Run', version: 2, orientation: 'any' },
      }),
    );
    await page.route('**/api/games/gPub/leaderboard', route => route.fulfill({ json: { gameId: 'gPub', top: [], me: null } }));
    await page.goto(`/g/${SLUG}`);
    await page.getByTestId('game-page-play').click();
    await expect(page.getByTestId('game-player')).toBeVisible();
    await expect.poll(() => page.frames().some(f => f.url().startsWith(PLAY_URL)), { timeout: 15_000 }).toBe(true);
    const frame = page.frames().find(f => f.url().startsWith(PLAY_URL))!;
    await frame.waitForFunction(() => typeof (window as unknown as { __crew?: unknown }).__crew === 'object');
    const sandbox = await page.getByTestId('game-player').locator('iframe').getAttribute('sandbox');
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });
});

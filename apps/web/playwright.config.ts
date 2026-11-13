import { defineConfig, devices } from '@playwright/test';

// Web e2e. Mobile-first: the phone project is the primary target; desktop checks the wide layout.
// The two-user chat test (e2e/chat.spec.ts) needs a running server with real Nexconn dev keys:
//   E2E_CHAT=1 E2E_API_ORIGIN=http://127.0.0.1:8080 pnpm e2e
// Without E2E_CHAT it skips with a message saying exactly that.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const API_ORIGIN = process.env.E2E_API_ORIGIN ?? 'http://127.0.0.1:8080';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Production build: what Vercel serves. /api/* is proxied to API_ORIGIN (next.config.ts).
    command: `pnpm build && pnpm exec next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { NEXT_PUBLIC_API_ORIGIN: API_ORIGIN },
  },
});

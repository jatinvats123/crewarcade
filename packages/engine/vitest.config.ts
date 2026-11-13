import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Browser tests launch Chromium and play games on a fake clock: give them room on slow CI.
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests that build their own harness (in-memory Postgres + migrations) can pass 5 s when the whole
  // suite runs in parallel; 20 s keeps them from flaking without hiding real hangs.
  test: { include: ['test/**/*.test.ts'], testTimeout: 20_000 },
});

import { defineConfig } from 'vitest/config';

// Root-level tests (repo scripts). Each package runs its own tests via `pnpm -r test`.
export default defineConfig({
  test: { include: ['scripts/**/*.test.ts'] },
});

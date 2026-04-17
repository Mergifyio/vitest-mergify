import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // e2e tests live under tests/e2e and are run via `playwright test`, not vitest.
    exclude: ['tests/e2e/**'],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'e2e',
    include: ['src/**/*.test.ts'],
    // Needs the coding-agent CLIs installed: run with `pnpm test:clients`.
    exclude: ['src/clients/**/*.client.test.ts', '**/node_modules/**'],
    globalSetup: ['src/global-setup.ts'],
    // Each file boots a workerd instance.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

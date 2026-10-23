import { defineConfig } from 'vitest/config';

// Real coding-agent CLIs against the Worker; they must be installed, so this is not part of `pnpm test`.
export default defineConfig({
  test: {
    name: 'e2e-clients',
    include: ['src/clients/**/*.client.test.ts'],
    globalSetup: ['src/clients/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One client at a time: they are heavy, and the matrix output stays readable.
    fileParallelism: false,
  },
});

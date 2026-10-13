import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'src/browser',
  testMatch: '**/*.spec.ts',
  globalSetup: './src/browser/global-setup.ts',
  timeout: 30_000,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    trace: 'retain-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
    // Chromium comes from `playwright install`, or from this variable where the browser is preinstalled elsewhere.
    ...(process.env['PLAYWRIGHT_CHROMIUM_PATH'] && {
      launchOptions: { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] },
    }),
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

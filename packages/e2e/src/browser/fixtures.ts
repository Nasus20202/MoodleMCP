import { test as base } from '@playwright/test';

import { type Stack, startStack } from './stack.ts';

interface WorkerFixtures {
  /** Whether the deployment has OAuth enabled (an `OAUTH_SECRET`). Set per file with `test.use`. */
  oauth: boolean;
  stack: Stack;
}

interface TestFixtures {
  /** Forgets what the previous test did to the mock Moodle. */
  resetMock: undefined;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  oauth: [false, { option: true, scope: 'worker' }],
  stack: [
    async ({ oauth }, use) => {
      const bundleDir = process.env.E2E_BUNDLE_DIR;
      const webDir = process.env.E2E_WEB_DIR;
      if (!(bundleDir && webDir)) throw new Error('The Playwright global setup did not run');
      const stack = await startStack({ bundleDir, webDir, oauth });
      await use(stack);
      await stack.stop();
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ stack }, use) => {
    await use(stack.url);
  },
  resetMock: [
    async ({ stack }, use) => {
      stack.network.reset();
      await use(undefined);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';

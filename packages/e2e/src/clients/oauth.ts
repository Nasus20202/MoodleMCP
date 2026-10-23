import { chromium } from '@playwright/test';

import { ALICE } from '../mock/data.ts';

const AUTHORIZE_URL = /https?:\/\/\S+\/oauth\/authorize\?\S+/;

/** The authorization URL a client printed, once it has. */
export const authorizationUrl = (output: string): string | undefined => AUTHORIZE_URL.exec(output)?.[0];

/**
 * Plays the user: opens the authorization URL in a real browser, signs in on the consent page with the Moodle
 * token and allows access. The browser is then sent to the client's own callback server, which finishes the
 * sign-in; the page is done once that server has answered.
 */
export async function approveAuthorization(authorizeUrl: string): Promise<void> {
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH && { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }),
  });
  try {
    const page = await browser.newPage();
    await page.goto(authorizeUrl);
    await page.getByLabel('Moodle token or app link').fill(ALICE.token);
    await page.getByRole('button', { name: 'Allow access' }).click();
    // The consent page navigates away to the callback address, which is plain http on loopback.
    await page.waitForURL((url) => url.pathname.includes('callback'), { timeout: 15_000 });
  } finally {
    await browser.close();
  }
}

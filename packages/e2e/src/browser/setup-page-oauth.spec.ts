import { ALICE } from '../mock/data.ts';
import { expect, test } from './fixtures.ts';

const tokenLink = (token: string) =>
  `moodlemobile://token=${Buffer.from(`site:::${token}:::private`).toString('base64')}`;

test.use({ oauth: true });

test('leads with the OAuth option and keeps the header as the alternative', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Option A: sign in with OAuth' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Option B: send a header' })).toBeVisible();
});

test('offers the token to paste on the consent page, masked until revealed', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('moodlemobile://token=…').fill(tokenLink(ALICE.token));
  const option = page
    .locator('section:not(.card)')
    .filter({ has: page.getByRole('heading', { name: 'Option A: sign in with OAuth' }) });
  await expect(option).not.toContainText(ALICE.token);
  await option.getByRole('button', { name: 'Show' }).click();
  await expect(option.locator('code', { hasText: ALICE.token })).toBeVisible();
});

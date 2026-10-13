import { createHash } from 'node:crypto';

import type { Page } from '@playwright/test';

import { McpClient } from '../mcp.ts';
import { ALICE, BOB, OTHER_SITE_URL, OTHER_SITE_USER, SITE_URL } from '../mock/data.ts';
import { expect, test } from './fixtures.ts';
import type { Stack } from './stack.ts';

const VERIFIER = 'b'.repeat(64);
/** Where the connector would receive the code: a loopback address, which OAuth allows over plain http. */
const CALLBACK_PATH = '/connector/callback';

test.use({ oauth: true });

/** Registers a client, starts an authorization for it and returns what the redirect must carry. */
async function startAuthorization(page: Page, stack: Stack, redirectUri = `${stack.url}${CALLBACK_PATH}`) {
  const registered = await page.request.post('/oauth/register', {
    data: { redirect_uris: [`${stack.url}${CALLBACK_PATH}`], client_name: 'Browser test' },
  });
  const { client_id } = (await registered.json()) as { client_id: string };
  const params = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: redirectUri,
    code_challenge: createHash('sha256').update(VERIFIER).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'browser-state',
  });
  await page.goto(`/oauth/authorize?${params.toString()}`);
  return { clientId: client_id, redirectUri: `${stack.url}${CALLBACK_PATH}` };
}

/** Waits for the browser to be sent back to the connector and returns that address. */
async function callbackUrl(page: Page): Promise<URL> {
  await page.waitForURL(`**${CALLBACK_PATH}?*`);
  return new URL(page.url());
}

const TOKEN_FIELD = 'Moodle token or app link';

async function submit(page: Page, token: string, site?: string) {
  if (site) await page.getByLabel('Moodle site').fill(site);
  await page.getByLabel(TOKEN_FIELD).fill(token);
  await page.getByRole('button', { name: 'Allow access' }).click();
}

test('a user signs in on the consent page and the connector gets working tokens', async ({ page, stack }) => {
  const { clientId, redirectUri } = await startAuthorization(page, stack);

  await expect(page).toHaveTitle(/Moodle/);
  await expect(page.getByText('127.0.0.1').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the Moodle sign-in page' })).toHaveAttribute(
    'href',
    new RegExp(`^${SITE_URL}/admin/tool/mobile/launch.php`),
  );

  await submit(page, ALICE.token);
  const url = await callbackUrl(page);
  expect(url.searchParams.get('state')).toBe('browser-state');
  expect(stack.moodle.restCalls.map((r) => r.fn)).toEqual(['core_webservice_get_site_info']);

  // The connector redeems the code, then talks MCP as Alice.
  const tokens = await page.request.post('/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      code: url.searchParams.get('code') ?? '',
      redirect_uri: redirectUri,
      code_verifier: VERIFIER,
      client_id: clientId,
    },
  });
  expect(tokens.status()).toBe(200);
  const { access_token } = (await tokens.json()) as { access_token: string };
  const info = await McpClient.bearer(stack.worker, access_token).json<{ userid: number }>('get_site_info');
  expect(info.userid).toBe(ALICE.id);
});

test('the site field starts at the default and can be changed to another allowed site', async ({
  page,
  stack,
}) => {
  await startAuthorization(page, stack);
  await expect(page.getByLabel('Moodle site')).toHaveValue(SITE_URL);

  await submit(page, OTHER_SITE_USER.token, OTHER_SITE_URL);
  await callbackUrl(page);
  expect(stack.other.restCalls).toHaveLength(1);
  expect(stack.moodle.requests).toHaveLength(0);
});

test('accepts the moodlemobile:// link in place of the token', async ({ page, stack }) => {
  await startAuthorization(page, stack);
  await submit(page, `moodlemobile://token=${Buffer.from(`s:::${BOB.token}:::p`).toString('base64')}`);
  await callbackUrl(page);
  expect(stack.moodle.restCalls[0]?.token).toBe(BOB.token);
});

test('keeps the user on the page, with an explanation, when Moodle rejects the token', async ({
  page,
  stack,
}) => {
  await startAuthorization(page, stack);
  await submit(page, 'not-a-valid-token');

  await expect(page.getByText('Moodle rejected this token')).toBeVisible();
  await expect(page.getByLabel(TOKEN_FIELD)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/connect');

  // Trying again with a good token works from the same page.
  await submit(page, ALICE.token);
  await callbackUrl(page);
});

test('says so when the site cannot be reached', async ({ page, stack }) => {
  await startAuthorization(page, stack);
  stack.moodle.down = true;
  await submit(page, ALICE.token);
  await expect(page.getByText('Could not reach that Moodle site')).toBeVisible();
});

test('explains a site the server does not allow without sending the token anywhere', async ({
  page,
  stack,
}) => {
  await startAuthorization(page, stack);
  await submit(page, ALICE.token, 'http://insecure.example.edu');
  await expect(page.getByText('must use https')).toBeVisible();
  expect(stack.network.sites.flatMap((s) => s.requests)).toHaveLength(0);
  expect(stack.network.stray).toEqual([]);
});

test('shows an error page, and never redirects, for an unregistered redirect address', async ({
  page,
  stack,
}) => {
  await startAuthorization(page, stack, 'https://attacker.example/cb');
  await expect(page.getByText('not registered for this client')).toBeVisible();
  await expect(page.getByLabel(TOKEN_FIELD)).toHaveCount(0);
  expect(stack.network.sites.flatMap((s) => s.requests)).toHaveLength(0);
});

test('cannot be framed by another site (clickjacking protection)', async ({ page, stack }) => {
  await startAuthorization(page, stack);
  expect(new URL(page.url()).pathname).toBe('/connect');
  const response = await page.request.get(page.url());
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(response.headers()['referrer-policy']).toBe('no-referrer');
});

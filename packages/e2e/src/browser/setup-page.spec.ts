import type { ToolsResponse } from '@moodle-mcp/shared';
import type { Page } from '@playwright/test';
import QRCode from 'qrcode';

import { McpClient } from '../mcp.ts';
import { ALICE, BOB, OTHER_SITE_URL, SITE_URL } from '../mock/data.ts';
import { expect, test } from './fixtures.ts';

/** The page's clipboard, read in the browser (this package's types have no DOM). */
const readClipboard = (page: Page): Promise<string> =>
  page.evaluate(() =>
    (
      globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }
    ).navigator.clipboard.readText(),
  );

const tokenLink = (token: string) =>
  `moodlemobile://token=${Buffer.from(`site:::${token}:::private`).toString('base64')}`;

/** A 1x1 white PNG: a valid image without a QR code. */
const BLANK_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8//8/AwAI/AL+XJ/PqQAAAABJRU5ErkJggg==';

test.describe('setup page (no OAuth)', () => {
  test('shows the three steps with the server’s default site filled in', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Moodle MCP');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Moodle MCP');
    await expect(page.getByRole('heading', { name: 'Get your token' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add it to your agent' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What your agent can do' })).toBeVisible();
    await expect(page.getByLabel('Moodle site')).toHaveValue(SITE_URL);
    // The endpoint shown is this deployment's own.
    await expect(page.locator('code', { hasText: '/mcp' }).first()).toHaveText(/\/mcp$/);
  });

  test('lists every tool the server exposes and expands them', async ({ page, request }) => {
    const { tools } = (await (await request.get('/api/tools')).json()) as ToolsResponse;
    await page.goto('/');
    await expect(page.getByText(`${tools.length} tools, loaded live from the server.`)).toBeVisible();
    await expect(page.locator('.tool-row')).toHaveCount(tools.length);
    for (const tool of tools)
      await expect(page.getByRole('heading', { name: tool.name, exact: true })).toBeVisible();

    await expect(page.locator('details.tool-row[open]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(page.locator('details.tool-row[open]')).toHaveCount(tools.length);
    await page.getByRole('button', { name: 'Collapse all' }).click();
    await expect(page.locator('details.tool-row[open]')).toHaveCount(0);

    await page.locator('summary', { hasText: 'get_course_contents' }).click();
    await expect(page.getByText('course_id').first()).toBeVisible();
  });

  test('does not offer OAuth when the server has none', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Send a header' })).toBeVisible();
    await expect(page.getByText('Option A: sign in with OAuth')).toHaveCount(0);
  });

  test('turns a pasted sign-in link into a token and builds the header from it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('code', { hasText: 'Authorization: Bearer <' })).toBeVisible();

    await page.getByPlaceholder('moodlemobile://token=…').fill(tokenLink(ALICE.token));
    await expect(page.getByText('✓ Token ready')).toBeVisible();

    // Hidden until asked for.
    const header = page.locator('code', { hasText: 'Authorization: Bearer' });
    await expect(header).not.toContainText(ALICE.token);
    await page.getByRole('button', { name: 'Show' }).first().click();
    await expect(header).toContainText(`Authorization: Bearer ${ALICE.token}`);
    await page.getByRole('button', { name: 'Hide' }).first().click();
    await expect(header).not.toContainText(ALICE.token);
  });

  test('copies a working header: the copied value authenticates against the server', async ({
    page,
    stack,
  }) => {
    await page.goto('/');
    await page.getByPlaceholder('moodlemobile://token=…').fill(tokenLink(BOB.token));
    await page.getByRole('button', { name: 'Copy value' }).first().click();
    await expect(page.getByRole('button', { name: '✓ Copied' })).toBeVisible();

    const copied = await readClipboard(page);
    expect(copied).toBe(`Bearer ${BOB.token}`);

    const response = await page.request.post('/mcp', {
      headers: {
        Authorization: copied,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_site_info', arguments: {} } },
    });
    expect(await response.text()).toContain(`\\"userid\\":${BOB.id}`);
    expect(stack.moodle.restCalls[0]?.token).toBe(BOB.token);
  });

  test('adds the site header only when the site differs from the default', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('X-Moodle-URL:')).toHaveCount(0);

    await page.getByLabel('Moodle site').fill(OTHER_SITE_URL);
    await expect(page.locator('code', { hasText: `X-Moodle-URL: ${OTHER_SITE_URL}` })).toBeVisible();

    await page.getByLabel('Moodle site').fill(SITE_URL);
    await expect(page.getByText('X-Moodle-URL:')).toHaveCount(0);
  });

  test('rejects text that is not a Moodle link', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('moodlemobile://token=…').fill('hello there');
    await expect(page.getByRole('alert')).toContainText('not a Moodle app QR code or token link');
    await expect(page.getByText('✓ Token ready')).toHaveCount(0);

    await page.getByPlaceholder('moodlemobile://token=…').fill('');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test.describe('QR screenshot', () => {
    const qrPng = (text: string) => QRCode.toBuffer(text, { type: 'png', width: 420, margin: 4 });
    const upload = async (page: Page, buffer: Buffer, name = 'qr.png', mimeType = 'image/png') => {
      await page.goto('/');
      await page.getByRole('tab', { name: 'QR screenshot' }).click();
      await page.locator('input[type=file]').setInputFiles({ name, mimeType, buffer });
    };

    test('exchanges the login key in the QR code for a token through the server', async ({ page, stack }) => {
      stack.moodle.issueQrKey('browser-key', ALICE);
      await upload(page, await qrPng(`moodlemobile://${SITE_URL}?qrlogin=browser-key&userid=${ALICE.id}`));
      await expect(page.getByText('✓ Token ready')).toBeVisible();

      // The key was spent on the mock Moodle, and the token it returned now works on /mcp.
      expect(stack.moodle.requests.some((r) => r.kind === 'ajax')).toBe(true);
      await page.getByRole('button', { name: 'Show' }).first().click();
      await expect(page.locator('code', { hasText: 'Authorization: Bearer' })).toContainText(ALICE.token);
      const client = new McpClient(stack.worker, { Authorization: `Bearer ${ALICE.token}` });
      expect((await client.json<{ userid: number }>('get_site_info')).userid).toBe(ALICE.id);
    });

    test('shows Moodle’s reason when the key is no longer valid', async ({ page }) => {
      await upload(page, await qrPng(`moodlemobile://${SITE_URL}?qrlogin=expired&userid=${ALICE.id}`));
      await expect(page.getByRole('alert')).toContainText('Invalid or expired QR login key');
    });

    test('sends a QR with only a site address to the browser sign-in tab', async ({ page }) => {
      await upload(page, await qrPng(SITE_URL.replace('https://', 'moodlemobile://')));
      await expect(page.getByText('only contains the site address')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Browser sign-in' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    test('says so when the image has no QR code', async ({ page }) => {
      await upload(page, Buffer.from(BLANK_PNG, 'base64'));
      await expect(page.getByRole('alert')).toContainText('No QR code found');
    });

    test('refuses files that are not images', async ({ page }) => {
      await upload(page, Buffer.from('hello'), 'notes.txt', 'text/plain');
      await expect(page.getByRole('alert')).toContainText('Please provide an image file');
    });
  });
});

test.describe('routing', () => {
  test('answers unknown pages with the not-found page, not indexed, and a way back', async ({ page }) => {
    const response = await page.goto('/no/such/page');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Page not found · Moodle MCP');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex');

    await page.getByRole('link', { name: 'Back to setup' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Get your token' })).toBeVisible();
  });

  test('keeps API paths out of the single-page app: unknown API paths are JSON 404s', async ({ request }) => {
    const res = await request.get('/api/nope');
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});

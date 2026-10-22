import type { ConfigResponse, ErrorResponse, ExchangeResponse, ToolsResponse } from '@moodle-mcp/shared';
import { describe, expect, it } from 'vitest';

import type { createApp } from '../app.ts';
import { setup } from '../app-test-utils.ts';
import { TEST_SITE, testConfig } from '../test-utils.ts';
import { ToolName } from '../tools/names.ts';

describe('/api', () => {
  it('GET /api/config returns the default site', async () => {
    const { app } = setup();
    const body = await (await app.request('/api/config')).json<ConfigResponse>();
    expect(body).toEqual({ moodleUrl: TEST_SITE, oauth: false });
  });

  it('GET /api/config reports when OAuth is enabled', async () => {
    const { app } = setup(undefined, testConfig({ oauthSecret: 'x'.repeat(32) }));
    const body = await (await app.request('/api/config')).json<ConfigResponse>();
    expect(body.oauth).toBe(true);
  });

  it('GET /api/tools returns the catalog without needing a token', async () => {
    const { app } = setup();
    const res = await app.request('/api/tools');
    const { tools } = await res.json<ToolsResponse>();
    expect(res.status).toBe(200);
    expect(tools).toHaveLength(Object.values(ToolName).length);
    const courseContents = tools.find((t) => t.name === ToolName.GetCourseContents);
    expect(courseContents?.readOnly).toBe(true);
    expect(courseContents?.inputSchema.required).toEqual(['course_id']);
    expect(courseContents?.inputSchema.properties?.course_id?.type).toBe('integer');
  });

  describe('POST /api/exchange', () => {
    const post = (app: ReturnType<typeof createApp>, body: unknown) =>
      app.request('/api/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const qr = (site: string) => `moodlemobile://${site}?qrlogin=key&userid=1`;

    it('exchanges a QR login for a token', async () => {
      const { app, moodle } = setup(() => [{ error: false, data: { token: 'newtoken' } }]);
      const res = await post(app, { qr: qr(TEST_SITE) });
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect((await res.json<ExchangeResponse>()).token).toBe('newtoken');
      expect(moodle.calls[0]?.url.href).toContain(`${TEST_SITE}/lib/ajax/service-nologin.php`);
    });

    it('refuses QR codes for sites the policy does not allow', async () => {
      const { app, moodle } = setup();
      const res = await post(app, { qr: qr('https://evil.example.org') });
      expect(res.status).toBe(400);
      expect(moodle.calls).toHaveLength(0);
    });

    it.each([
      ['a QR without a key', { qr: `moodlemobile://${TEST_SITE}` }],
      ['a missing field', {}],
      ['an empty QR', { qr: '' }],
    ])('rejects %s', async (_name, body) => {
      const { app } = setup();
      expect((await post(app, body)).status).toBe(400);
    });

    it('rejects an oversized body', async () => {
      const { app } = setup();
      const res = await app.request('/api/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': '99999' },
        body: JSON.stringify({ qr: 'x' }),
      });
      expect(res.status).toBe(413);
    });

    it('reports a disabled QR login as a bad gateway with Moodle’s reason', async () => {
      const { app } = setup(() => [
        { error: true, exception: { errorcode: 'qrcodedisabled', message: 'off' } },
      ]);
      const res = await post(app, { qr: qr(TEST_SITE) });
      expect(res.status).toBe(502);
      expect((await res.json<ErrorResponse>()).error).toContain('qrcodedisabled');
    });

    it('does not log the key or the token', async () => {
      const { app, logs } = setup(() => [{ error: false, data: { token: 'newtoken' } }]);
      await post(app, { qr: qr(TEST_SITE) });
      expect(logs.join('\n')).not.toMatch(/newtoken|qrlogin|key/);
    });
  });
});

import type { ConfigResponse, ErrorResponse, ExchangeResponse, ToolsResponse } from '@moodle-mcp/shared';
import { describe, expect, it } from 'vitest';

import { McpClient } from './mcp.ts';
import { ALICE, BOB, OTHER_SITE_URL, OTHER_SITE_USER, SITE_URL } from './mock/data.ts';
import { useWorld } from './world.ts';

const qrLink = (site: string, key: string, userId: number) =>
  `moodlemobile://${site}?qrlogin=${key}&userid=${userId}`;

describe('the setup page API', () => {
  const world = useWorld({ ALLOWED_MOODLE_HOSTS: '' });
  const exchange = (body: unknown, init: RequestInit = {}) =>
    world.worker.fetch('/api/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    });

  describe('GET /api/config', () => {
    it('names the default site and reports OAuth as off', async () => {
      const res = await world.worker.fetch('/api/config');
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toContain('max-age');
      expect((await res.json()) as ConfigResponse).toEqual({ moodleUrl: SITE_URL, oauth: false });
    });
  });

  describe('GET /api/tools', () => {
    it('lists the same tools as the MCP endpoint, without needing a token', async () => {
      const res = await world.worker.fetch('/api/tools');
      expect(res.status).toBe(200);
      const { tools } = (await res.json()) as ToolsResponse;
      const mcp = await McpClient.bearer(world.worker, ALICE.token).listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(mcp.map((t) => t.name).sort());
      expect(tools.every((t) => t.readOnly)).toBe(true);
      expect(tools.every((t) => t.description.length > 0)).toBe(true);
      expect(world.moodle.restCalls).toHaveLength(0);
    });

    it('describes arguments for the page', async () => {
      const { tools } = (await (await world.worker.fetch('/api/tools')).json()) as ToolsResponse;
      const contents = tools.find((t) => t.name === 'get_course_contents');
      expect(contents?.inputSchema.required).toEqual(['course_id']);
      expect(contents?.inputSchema.properties?.course_id?.type).toBe('integer');
    });
  });

  describe('POST /api/exchange (QR login)', () => {
    it('trades a QR login for a token that then works on /mcp', async () => {
      world.moodle.issueQrKey('qr-key-1', ALICE);
      const res = await exchange({ qr: qrLink(SITE_URL, 'qr-key-1', ALICE.id) });
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const { token } = (await res.json()) as ExchangeResponse;
      expect(token).toBe(ALICE.token);

      const ajax = world.moodle.requests.find((r) => r.kind === 'ajax');
      expect(ajax?.fn).toBe('tool_mobile_get_tokens_for_qr_login');
      expect(ajax?.userAgent).toMatch(/^MoodleMobile\//);

      const info = await McpClient.bearer(world.worker, token).json<{ userid: number }>('get_site_info');
      expect(info.userid).toBe(ALICE.id);
    });

    it('works for each user and each key independently', async () => {
      world.moodle.issueQrKey('key-a', ALICE);
      world.moodle.issueQrKey('key-b', BOB);
      const [a, b] = await Promise.all([
        exchange({ qr: qrLink(SITE_URL, 'key-a', ALICE.id) }),
        exchange({ qr: qrLink(SITE_URL, 'key-b', BOB.id) }),
      ]);
      expect(((await a.json()) as ExchangeResponse).token).toBe(ALICE.token);
      expect(((await b.json()) as ExchangeResponse).token).toBe(BOB.token);
    });

    it('passes on Moodle’s refusal of a reused or unknown key as a bad gateway with the reason', async () => {
      world.moodle.issueQrKey('once', ALICE);
      expect((await exchange({ qr: qrLink(SITE_URL, 'once', ALICE.id) })).status).toBe(200);
      const again = await exchange({ qr: qrLink(SITE_URL, 'once', ALICE.id) });
      expect(again.status).toBe(502);
      expect(((await again.json()) as ErrorResponse).error).toContain('Invalid or expired QR login key');
    });

    it('reports an unreachable site as a bad gateway', async () => {
      world.moodle.down = true;
      const res = await exchange({ qr: qrLink(SITE_URL, 'k', 1) });
      expect(res.status).toBe(502);
    });

    it('never contacts a site the policy does not allow', async () => {
      for (const site of [
        OTHER_SITE_URL,
        'https://evil.example.org',
        'http://moodle.example.edu/2025',
        'https://127.0.0.1',
      ]) {
        const res = await exchange({ qr: qrLink(site, 'k', 1) });
        expect(res.status, site).toBe(400);
      }
      world.other.issueQrKey('k', OTHER_SITE_USER);
      expect(world.network.sites.flatMap((s) => s.requests)).toHaveLength(0);
      expect(world.network.stray).toEqual([]);
    });

    it.each([
      ['a QR without a key', { qr: `moodlemobile://${SITE_URL}` }],
      ['a QR that is not a Moodle link', { qr: 'https://example.com' }],
      ['an empty QR', { qr: '' }],
      ['a missing field', {}],
      ['a QR of the wrong type', { qr: 5 }],
      ['not JSON', 'nope'],
    ])('rejects %s without contacting Moodle', async (_name, body) => {
      const res = await exchange(body);
      expect(res.status).toBe(400);
      expect(world.moodle.requests).toHaveLength(0);
    });

    it('rejects an oversized body, with and without Content-Length', async () => {
      const big = JSON.stringify({ qr: 'x'.repeat(10_000) });
      expect((await exchange(big)).status).toBe(413);
      const chunked = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(big));
          controller.close();
        },
      });
      const res = await world.worker.fetch('/api/exchange', {
        method: 'POST',
        body: chunked,
        duplex: 'half',
      });
      expect(res.status).toBe(413);
      expect(world.moodle.requests).toHaveLength(0);
    });
  });

  describe('routing', () => {
    it('answers unknown API paths with a JSON 404', async () => {
      const res = await world.worker.fetch('/api/nope');
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not found' });
    });

    it('does not expose the exchange endpoint through GET', async () => {
      expect((await world.worker.fetch('/api/exchange')).status).toBe(404);
    });
  });
});

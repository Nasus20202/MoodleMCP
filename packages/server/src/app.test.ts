import type { ConfigResponse, ErrorResponse, ExchangeResponse, ToolsResponse } from '@moodle-mcp/shared';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.ts';
import { tokenFingerprint } from './http/client-info.ts';
import { createLogger } from './logger.ts';
import { fakeMoodle, type RecordedCall, TEST_SITE, testConfig } from './test-utils.ts';
import { ToolName } from './tools/names.ts';

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

interface RpcResponse {
  result?: {
    tools?: { name: string; annotations?: { readOnlyHint?: boolean } }[];
    content?: { text: string }[];
    isError?: boolean;
  };
  error?: { message: string };
}

function setup(respond: (call: RecordedCall) => unknown = () => ({}), config = testConfig()) {
  const moodle = fakeMoodle(respond);
  const logs: string[] = [];
  const logger = createLogger('debug', (_l, line) => logs.push(line));
  const app = createApp(config, { fetch: moodle.fetch, logger });
  return { app, moodle, logs };
}

interface RpcReply {
  status: number;
  headers: Headers;
  /** The JSON-RPC message, or the JSON error body for HTTP-level failures. */
  body: RpcResponse & Partial<ErrorResponse>;
}

/** The MCP endpoint answers either plain JSON or a single SSE `data:` event; read it fully either way. */
async function readReply(res: Response): Promise<RpcReply> {
  const text = await res.text();
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  return {
    status: res.status,
    headers: res.headers,
    body: JSON.parse(data ? data.slice(6) : text || '{}') as RpcReply['body'],
  };
}

async function rpc(
  app: ReturnType<typeof createApp>,
  method: string,
  params?: unknown,
  headers: Record<string, string> = {},
): Promise<RpcReply> {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { ...MCP_HEADERS, Authorization: 'Bearer user-token', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return readReply(res);
}

const callTool = (app: ReturnType<typeof createApp>, name: string, args: unknown = {}, headers = {}) =>
  rpc(app, 'tools/call', { name, arguments: args }, headers);

const restCalls = (moodle: { calls: RecordedCall[] }) =>
  moodle.calls.filter((c) => c.url.pathname.endsWith('/webservice/rest/server.php'));

describe('/mcp authentication', () => {
  it('rejects requests without a token', async () => {
    const { app } = setup();
    const res = await readReply(
      await app.request('/mcp', { method: 'POST', headers: MCP_HEADERS, body: '{}' }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
    expect(res.body.error).toMatch(/Missing Moodle token/);
  });

  it('accepts X-Moodle-Token as an alternative', async () => {
    const { app } = setup();
    const res = await rpc(app, 'tools/list', undefined, {
      Authorization: '',
      'X-Moodle-Token': 'user-token',
    });
    expect(res.status).toBe(200);
  });

  it('rejects a site that the policy does not allow', async () => {
    const { app, moodle } = setup();
    const res = await callTool(app, ToolName.GetSiteInfo, {}, { 'X-Moodle-URL': 'https://evil.example.org' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not allowed/);
    expect(moodle.calls).toHaveLength(0);
  });
});

describe('/mcp tools', () => {
  it('lists every tool as read-only', async () => {
    const { app } = setup();
    const { body } = await rpc(app, 'tools/list');
    const tools = body.result?.tools ?? [];
    expect(tools.map((t) => t.name).sort()).toEqual(Object.values(ToolName).sort());
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('is stateless: repeated calls need no session', async () => {
    const { app } = setup();
    for (let i = 0; i < 2; i++) expect((await rpc(app, 'tools/list')).status).toBe(200);
  });

  it('passes Moodle JSON through, using the caller token and the default site', async () => {
    const { app, moodle } = setup(() => [{ id: 5, fullname: 'Maths' }]);
    const { body } = await callTool(app, ToolName.SearchCourses, { query: 'math' });

    expect(JSON.parse(body.result?.content?.[0]?.text ?? '')).toEqual([{ id: 5, fullname: 'Maths' }]);
    const [call] = restCalls(moodle);
    expect(call?.url.href).toBe(`${TEST_SITE}/webservice/rest/server.php`);
    expect(call?.body).toMatchObject({
      wstoken: 'user-token',
      wsfunction: 'core_course_search_courses',
      criterianame: 'search',
      criteriavalue: 'math',
    });
  });

  it('looks up the user id for tools that need it', async () => {
    const { app, moodle } = setup((call) =>
      (call.body as Record<string, string>).wsfunction === 'core_webservice_get_site_info'
        ? { userid: 9 }
        : [],
    );
    await callTool(app, ToolName.ListCourses);
    expect(restCalls(moodle).map((c) => (c.body as Record<string, string>).wsfunction)).toEqual([
      'core_webservice_get_site_info',
      'core_enrol_get_users_courses',
    ]);
    expect(restCalls(moodle)[1]?.body).toMatchObject({ userid: '9' });
  });

  it.each([
    [ToolName.GetCourseContents, { course_id: 3 }, { courseid: '3' }],
    [ToolName.ListAssignments, { course_id: 3 }, { 'courseids[0]': '3' }],
    [ToolName.ListForums, { course_id: 3 }, { 'courseids[0]': '3' }],
    [ToolName.ListPages, { course_id: 3 }, { 'courseids[0]': '3' }],
    [ToolName.GetSubmissionStatus, { assign_id: 4 }, { assignid: '4' }],
    [ToolName.ListForumDiscussions, { forum_id: 5 }, { forumid: '5' }],
  ])('%s maps its input to Moodle parameters', async (tool, args, expected) => {
    const { app, moodle } = setup();
    await callTool(app, tool, args);
    expect(restCalls(moodle)[0]?.body).toMatchObject(expected);
  });

  it('uses the site from the X-Moodle-URL header when allowed', async () => {
    const { app, moodle } = setup(() => ({}), testConfig({ allowedHosts: ['*'] }));
    await callTool(
      app,
      ToolName.GetUpcomingEvents,
      {},
      { 'X-Moodle-URL': 'https://other.example.org/moodle' },
    );
    expect(restCalls(moodle)[0]?.url.href).toBe(
      'https://other.example.org/moodle/webservice/rest/server.php',
    );
  });

  it('reports Moodle errors as tool errors the model can read', async () => {
    const { app } = setup(() => ({ exception: 'x', errorcode: 'invalidtoken', message: 'Invalid token' }));
    const { body } = await callTool(app, ToolName.GetSiteInfo);
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain('invalidtoken');
  });

  it('rejects invalid arguments without calling Moodle', async () => {
    const { app, moodle } = setup();
    const { body } = await callTool(app, ToolName.GetCourseContents, { course_id: 'x' });
    expect(body.result?.isError ?? body.error).toBeTruthy();
    expect(moodle.calls).toHaveLength(0);
  });

  it('never logs the token', async () => {
    const { app, logs } = setup();
    await callTool(app, ToolName.GetSiteInfo);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain('user-token');
  });

  it('tags every log line of a request with the client IP and a token fingerprint', async () => {
    const { app, logs } = setup(() => ({ exception: 'x', errorcode: 'e', message: 'm' }));
    await callTool(app, ToolName.GetSiteInfo, {}, { 'CF-Connecting-IP': '203.0.113.7' });

    const lines = logs.map((l) => JSON.parse(l) as Record<string, unknown>);
    const tokenId = await tokenFingerprint('user-token');
    for (const msg of ['request', 'tool call', 'moodle call failed']) {
      const line = lines.find((l) => l.msg === msg);
      expect(line, msg).toMatchObject({ ip: '203.0.113.7', tokenId });
    }
    expect(logs.join('\n')).not.toContain('user-token');
  });

  it('logs the IP of unauthenticated requests, without a fingerprint', async () => {
    const { app, logs } = setup();
    await app.request('/mcp', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' }, body: '{}' });
    const line = JSON.parse(logs[0] ?? '{}') as Record<string, unknown>;
    expect(line).toMatchObject({ msg: 'request', status: 401, ip: '203.0.113.9' });
    expect(line).not.toHaveProperty('tokenId');
  });
});

describe('/api', () => {
  it('GET /api/config returns the default site', async () => {
    const { app } = setup();
    const body = await (await app.request('/api/config')).json<ConfigResponse>();
    expect(body).toEqual({ moodleUrl: TEST_SITE });
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

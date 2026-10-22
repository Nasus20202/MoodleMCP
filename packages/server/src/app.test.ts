import { describe, expect, it } from 'vitest';

import { callTool, MCP_HEADERS, readReply, restCalls, rpc, setup } from './app-test-utils.ts';
import { tokenFingerprint } from './http/client-info.ts';
import { TEST_SITE, testConfig } from './test-utils.ts';
import { ToolName } from './tools/names.ts';

describe('client identification in logs', () => {
  it('logs the MCP client announced at initialize, with the User-Agent', async () => {
    const { app, logs } = setup();
    await rpc(
      app,
      'initialize',
      {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'claude-code', version: '2.0.1' },
      },
      { 'User-Agent': 'claude-code/2.0.1' },
    );
    const lines = logs.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.find((l) => l.msg === 'mcp client initialized')).toMatchObject({
      clientName: 'claude-code',
      clientVersion: '2.0.1',
      userAgent: 'claude-code/2.0.1',
    });
    expect(lines.find((l) => String(l.msg).startsWith('POST /mcp'))).toMatchObject({
      userAgent: 'claude-code/2.0.1',
    });
  });

  it('does not log a client for requests other than initialize', async () => {
    const { app, logs } = setup();
    await rpc(app, 'tools/list');
    expect(logs.join('\n')).not.toContain('mcp client initialized');
  });
});

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
    [ToolName.GetCourseModule, { cmid: 6 }, { cmid: '6' }],
    [ToolName.ListResources, { course_id: 3 }, { 'courseids[0]': '3' }],
    [ToolName.ListUrls, { course_id: 3 }, { 'courseids[0]': '3' }],
    [ToolName.ListLabels, { course_id: 3 }, { 'courseids[0]': '3' }],
    [ToolName.ListWikis, { course_id: 3 }, { 'courseids[0]': '3' }],
    [ToolName.ListQuizzes, { course_id: 3 }, { 'courseids[0]': '3' }],
    [ToolName.GetWikiPages, { wiki_id: 7 }, { wikiid: '7' }],
    [ToolName.GetQuizAttemptReview, { attempt_id: 8 }, { attemptid: '8', page: '-1' }],
    [
      ToolName.GetForumPosts,
      { discussion_id: 9 },
      { discussionid: '9', sortby: 'created', sortdirection: 'ASC' },
    ],
    [ToolName.GetCourseEvents, { course_id: 3 }, { courseid: '3' }],
  ])('%s maps its input to Moodle parameters', async (tool, args, expected) => {
    const { app, moodle } = setup();
    await callTool(app, tool, args);
    expect(restCalls(moodle)[0]?.body).toMatchObject(expected);
  });

  it.each([
    [ToolName.GetQuizAttempts, { quiz_id: 4 }, { quizid: '4', userid: '9', status: 'all' }],
    [ToolName.GetCourseCompletion, { course_id: 3 }, { courseid: '3', userid: '9' }],
    [ToolName.GetGradesOverview, {}, { userid: '9' }],
  ])('%s passes the token owner as userid', async (tool, args, expected) => {
    const { app, moodle } = setup(() => ({ userid: 9 }));
    await callTool(app, tool, args);
    expect(restCalls(moodle)[1]?.body).toMatchObject(expected);
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

  it('logs why a tool call failed', async () => {
    const { app, logs } = setup(() => ({ exception: 'x', errorcode: 'invalidtoken', message: 'm' }));
    await callTool(app, ToolName.GetSiteInfo);
    const lines = logs.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.find((l) => l.tool === ToolName.GetSiteInfo)).toMatchObject({
      ok: false,
      error: 'invalidtoken',
    });
    expect(lines.find((l) => String(l.msg).startsWith('moodle ') && l.ok === false)).toMatchObject({
      ok: false,
    });
  });

  it('logs successful Moodle calls with the function name only', async () => {
    const { app, logs } = setup(() => [{ id: 1 }]);
    await callTool(app, ToolName.SearchCourses, { query: 'PRIVATE-QUERY' });
    const line = logs
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => String(l.msg).startsWith('moodle ') && l.ok === true);
    expect(line).toMatchObject({
      level: 'info',
      function: 'core_course_search_courses',
      endpoint: '/webservice/rest/server.php',
      site: TEST_SITE,
      ok: true,
    });
    expect(logs.join('\n')).not.toContain('PRIVATE-QUERY');
  });

  it('logs how large a tool result was, never its content', async () => {
    const { app, logs } = setup(() => [{ id: 1, fullname: 'PRIVATE-NAME' }]);
    await callTool(app, ToolName.SearchCourses, { query: 'x' });
    const line = logs
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.tool === ToolName.SearchCourses && l.ok === true);
    expect(line?.chars).toBe(JSON.stringify([{ id: 1, fullname: 'PRIVATE-NAME' }]).length);
    expect(logs.join('\n')).not.toContain('PRIVATE-NAME');
  });

  it('attaches pictures pasted into a page after the text, marked where they sat', async () => {
    const html = '<p>Look</p><img alt="" src="data:image/png;base64,iVBORw0KGgo=">';
    const { app } = setup(() => ({ pages: [{ id: 1, content: html }] }));
    const reply = await callTool(app, ToolName.ListPages, { course_id: 3 });
    const content = (reply.body.result as { content: { type: string; text?: string; data?: string }[] })
      .content;
    expect(content.map((b) => b.type)).toEqual(['text', 'image', 'text']);
    expect(content[0]?.text).toContain('<img alt=\\"\\" data-image=\\"1\\">');
    expect(content[0]?.text).not.toContain('base64');
    expect(content[1]?.data).toBe('iVBORw0KGgo=');
    expect(content[2]?.text).toContain('1 image(s)');
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
    for (const key of ['status', 'tool', 'function']) {
      const line = lines.find((l) => key in l);
      expect(line, key).toMatchObject({ ip: '203.0.113.7', tokenId });
    }
    expect(logs.join('\n')).not.toContain('user-token');
  });

  it('logs the IP of unauthenticated requests, without a fingerprint', async () => {
    const { app, logs } = setup();
    await app.request('/mcp', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' }, body: '{}' });
    const lines = logs.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({ level: 'warn', ip: '203.0.113.9' });
    expect(String(lines[0]?.msg)).toMatch(/^auth rejected: Missing Moodle token/);
    const line = lines[1] ?? {};
    expect(line).toMatchObject({ status: 401, ip: '203.0.113.9' });
    expect(line.msg).toMatch(/^POST \/mcp 401 \d+ms$/);
    expect(line).not.toHaveProperty('tokenId');
  });
});

it('logs oversized bodies', async () => {
  const { app, logs } = setup();
  await app.request('/api/exchange', {
    method: 'POST',
    headers: { 'Content-Length': '99999', 'CF-Connecting-IP': '203.0.113.5' },
    body: '{}',
  });
  const lines = logs.map((l) => JSON.parse(l) as Record<string, unknown>);
  expect(lines.find((l) => l.msg === 'request rejected: too large')).toMatchObject({ ip: '203.0.113.5' });
});

it('refuses a body over the limit even without a Content-Length', async () => {
  const { app } = setup();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(10_000)));
      controller.close();
    },
  });
  const res = await app.request('/api/exchange', { method: 'POST', body, duplex: 'half' } as RequestInit);
  expect(res.status).toBe(413);
});

it('answers unknown paths with a JSON 404', async () => {
  const { app } = setup();
  const res = await app.request('/api/nope');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'Not found' });
});

it('logs unknown paths at info like any other request, without the query string', async () => {
  const { app, logs } = setup();
  await app.request('/wp-login.php?secret=1', { headers: { 'CF-Connecting-IP': '203.0.113.8' } });
  const line = logs.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.status === 404);
  expect(line).toMatchObject({
    level: 'info',
    method: 'GET',
    path: '/wp-login.php',
    ip: '203.0.113.8',
  });
  expect(line?.msg).toMatch(/^GET \/wp-login\.php 404 \d+ms$/);
  expect(logs.join('\n')).not.toContain('secret=1');
});

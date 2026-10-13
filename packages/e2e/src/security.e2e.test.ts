import { describe, expect, it } from 'vitest';

import { McpClient } from './mcp.ts';
import { ALICE, BOB, COURSE_ALG, FILE_URLS, IDS, OTHER_SITE_USER, SITE_URL } from './mock/data.ts';
import { IMPLEMENTED_FUNCTIONS } from './mock/moodle.ts';
import { OAUTH_SECRET } from './worker.ts';
import { useWorld } from './world.ts';

/** Every tool with arguments that make it run, so the whole surface can be exercised at once. */
const EVERY_TOOL: [string, Record<string, unknown>][] = [
  ['get_site_info', {}],
  ['list_courses', {}],
  ['search_courses', { query: 'alg' }],
  ['get_course_contents', { course_id: COURSE_ALG }],
  ['get_course_module', { cmid: IDS.cmidAssign }],
  ['read_file', { file_url: FILE_URLS.notes }],
  ['read_file', { file_url: FILE_URLS.slides, raw: true }],
  ['list_resources', { course_id: COURSE_ALG }],
  ['list_pages', { course_id: COURSE_ALG }],
  ['list_urls', { course_id: COURSE_ALG }],
  ['list_labels', { course_id: COURSE_ALG }],
  ['list_wikis', { course_id: COURSE_ALG }],
  ['get_wiki_pages', { wiki_id: IDS.wiki }],
  ['list_assignments', { course_id: COURSE_ALG }],
  ['get_submission_status', { assign_id: IDS.assign }],
  ['list_quizzes', { course_id: COURSE_ALG }],
  ['get_quiz_attempts', { quiz_id: IDS.quiz }],
  ['get_quiz_attempt_review', { attempt_id: IDS.attempt }],
  ['get_upcoming_events', {}],
  ['get_course_events', { course_id: COURSE_ALG }],
  ['get_course_completion', { course_id: COURSE_ALG }],
  ['get_grades', { course_id: COURSE_ALG }],
  ['get_grades_overview', {}],
  ['list_forums', { course_id: COURSE_ALG }],
  ['list_forum_discussions', { forum_id: IDS.forum }],
  ['get_forum_posts', { discussion_id: IDS.discussion }],
  ['get_notifications', {}],
];

describe('the Worker never writes to Moodle', () => {
  const world = useWorld();

  it('only ever calls read-only web service functions, and each only by POSTing to the REST endpoint', async () => {
    const client = McpClient.bearer(world.worker, ALICE.token);
    for (const [tool, args] of EVERY_TOOL) await client.call(tool, args);

    const functions = new Set(world.moodle.restCalls.map((r) => r.fn));
    // Every function that a tool can reach is one the mock implements, and every implemented one is exercised.
    expect([...functions].sort()).toEqual([...IMPLEMENTED_FUNCTIONS].sort());
    for (const fn of functions) {
      expect(fn, 'a read-only operation').toMatch(/_get_|_search_/);
      expect(fn).not.toMatch(
        /(^|_)(create|update|delete|submit|add|set|save|remove|view|send|mark|toggle|start|finish|process)_/,
      );
    }
    for (const request of world.moodle.requests) {
      expect(['rest', 'file']).toContain(request.kind);
      expect(request.method).toBe(request.kind === 'file' ? 'GET' : 'POST');
    }
    expect(world.network.stray).toEqual([]);
  });

  it('cannot be talked into other functions: tool arguments never choose the Moodle function', async () => {
    const client = McpClient.bearer(world.worker, ALICE.token);
    await client.call('search_courses', {
      query: 'x',
      wsfunction: 'core_course_delete_courses',
      'ids[0]': 101,
    });
    await client.call('list_courses', { wsfunction: 'core_user_update_users' });
    expect(world.moodle.restCalls.map((r) => r.fn)).toEqual([
      'core_course_search_courses',
      'core_webservice_get_site_info',
      'core_enrol_get_users_courses',
    ]);
  });

  it('does not offer any tool that could change something', async () => {
    const tools = await McpClient.bearer(world.worker, ALICE.token).listTools();
    for (const { name } of tools) expect(name).toMatch(/^(get|list|search|read)_/);
  });
});

describe('secrets stay out of logs and responses', () => {
  const world = useWorld({ OAUTH_SECRET, ALLOWED_MOODLE_HOSTS: '*' }, { clearLogs: true });

  const SECRETS = [ALICE.token, BOB.token, OTHER_SITE_USER.token, 'qr-key-secret', OAUTH_SECRET];

  it('keeps tokens, OAuth codes, QR keys and file details out of everything the Worker logs', async () => {
    const alice = McpClient.bearer(world.worker, ALICE.token);
    for (const [tool, args] of EVERY_TOOL) await alice.call(tool, args);
    await McpClient.bearer(world.worker, 'wrong-token-value').call('get_site_info');
    await world.worker.fetch('/mcp', { method: 'POST', body: '{}' });

    // OAuth: register, consent, redeem, refresh.
    const challenge = 'c'.repeat(43);
    const registered = (await (
      await world.worker.fetch('/oauth/register', {
        method: 'POST',
        body: JSON.stringify({ redirect_uris: ['https://chat.example.com/cb'] }),
      })
    ).json()) as { client_id: string };
    const consent = await world.worker.fetch('/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        response_type: 'code',
        client_id: registered.client_id,
        redirect_uri: 'https://chat.example.com/cb',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        site: SITE_URL,
        token: BOB.token,
      }),
    });
    const code = new URL(consent.headers.get('Location') ?? '').searchParams.get('code') ?? '';
    expect(code).not.toBe('');
    // QR exchange.
    world.moodle.issueQrKey('qr-key-secret', ALICE);
    await world.worker.fetch('/api/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr: `moodlemobile://${SITE_URL}?qrlogin=qr-key-secret&userid=${ALICE.id}` }),
    });

    const logs = await world.worker.rawLogs();
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [...SECRETS, code, registered.client_id, 'wrong-token-value']) {
      expect(logs, secret).not.toContain(secret);
    }
    // Neither parameter values, file names, nor file contents.
    for (const detail of ['notes.txt', 'slides.pdf', 'pluginfile', 'Big-O', 'alg', 'Lecture one slides']) {
      expect(logs, detail).not.toContain(detail);
    }
  });

  it('tags every request’s log lines with the client IP and a token fingerprint, never the token', async () => {
    await McpClient.bearer(world.worker, ALICE.token).call('get_site_info');
    const lines = (await world.worker.logs()).filter((l) => typeof l.tokenId === 'string');
    expect(lines.length).toBeGreaterThan(2);
    const ids = new Set(lines.map((l) => l.tokenId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^[0-9a-f]{12}$/);
    for (const line of lines) expect(line.ip).toBeTruthy();
  });

  it('gives different callers different fingerprints', async () => {
    await McpClient.bearer(world.worker, ALICE.token).call('get_site_info');
    await McpClient.bearer(world.worker, BOB.token).call('get_site_info');
    const ids = new Set((await world.worker.logs()).map((l) => l.tokenId).filter(Boolean));
    expect(ids.size).toBe(2);
  });

  it('logs outcomes and sizes of tool calls and downloads', async () => {
    const alice = McpClient.bearer(world.worker, ALICE.token);
    await alice.call('list_courses');
    await alice.call('read_file', { file_url: FILE_URLS.notes });
    await alice.call('get_submission_status', { assign_id: 999 });
    const logs = await world.worker.logs();
    expect(logs.find((l) => l.tool === 'list_courses')).toMatchObject({ ok: true });
    expect(logs.find((l) => l.function === 'core_enrol_get_users_courses')).toMatchObject({
      ok: true,
      site: SITE_URL,
    });
    expect(logs.find((l) => String(l.msg).startsWith('moodle download'))).toMatchObject({
      ok: true,
      mime: 'text/plain',
    });
    expect(logs.find((l) => l.tool === 'get_submission_status')).toMatchObject({
      ok: false,
      error: 'invalidrecord',
    });
  });

  it('logs every request at info, including unknown paths', async () => {
    await world.worker.fetch('/api/nope');
    await world.worker.fetch('/.env');
    const lines = await world.worker.logs();
    expect(lines.find((l) => l.msg.startsWith('GET /api/nope 404'))).toMatchObject({
      level: 'info',
      status: 404,
    });
    expect(lines.find((l) => l.msg.startsWith('GET /.env 404'))).toMatchObject({
      level: 'info',
      status: 404,
    });
  });

  it('logs why a caller was turned away, with the IP and without credentials', async () => {
    await world.worker.fetch('/mcp', { method: 'POST', body: '{}' });
    const line = (await world.worker.logs()).find((l) => String(l.msg).startsWith('auth rejected'));
    expect(line).toMatchObject({ level: 'warn', path: '/mcp' });
    expect(line?.ip).toBeTruthy();
    expect(line).not.toHaveProperty('tokenId');
  });

  it('does not reflect secrets in error responses', async () => {
    const res = await world.worker.fetch('/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer mm1.tampered-secret-value.abc', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('tampered-secret-value');
  });
});

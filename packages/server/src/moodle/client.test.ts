import { describe, expect, it } from 'vitest';

import { createLogger } from '../logger.ts';
import { fakeMoodle, TEST_SITE } from '../test-utils.ts';
import { MoodleClient, USER_AGENT } from './client.ts';
import { MoodleTransportError } from './errors.ts';
import { MoodleFunction } from './functions.ts';

const clientFor = (fetchImpl: typeof fetch, token = 'tok') =>
  new MoodleClient({ baseUrl: `${TEST_SITE}/`, token, fetch: fetchImpl });

describe('MoodleClient.call', () => {
  it('posts a REST call and decodes the JSON result', async () => {
    const moodle = fakeMoodle(() => ({ ok: 1 }));
    const result = await clientFor(moodle.fetch).call(MoodleFunction.SiteInfo, { a: 'b', n: 2 });

    expect(result).toEqual({ ok: 1 });
    const [call] = moodle.calls;
    expect(call?.url.href).toBe(`${TEST_SITE}/webservice/rest/server.php`);
    expect(call?.headers.get('User-Agent')).toBe(USER_AGENT);
    expect(call?.body).toEqual({
      a: 'b',
      n: '2',
      wstoken: 'tok',
      wsfunction: MoodleFunction.SiteInfo,
      moodlewsrestformat: 'json',
    });
  });

  it('turns Moodle exceptions into MoodleError', async () => {
    const moodle = fakeMoodle(() => ({ exception: 'x', errorcode: 'invalidtoken', message: 'bad token' }));
    await expect(clientFor(moodle.fetch).call(MoodleFunction.SiteInfo)).rejects.toMatchObject({
      name: 'MoodleError',
      code: 'invalidtoken',
      message: 'invalidtoken: bad token',
    });
  });

  it('turns HTTP failures, bad bodies and network errors into MoodleTransportError', async () => {
    const notFound = fakeMoodle(() => new Response('nope', { status: 404 }));
    await expect(clientFor(notFound.fetch).call(MoodleFunction.SiteInfo)).rejects.toThrow(/HTTP 404/);

    const html = fakeMoodle(() => new Response('<html>', { status: 200 }));
    await expect(clientFor(html.fetch).call(MoodleFunction.SiteInfo)).rejects.toBeInstanceOf(
      MoodleTransportError,
    );

    const offline: typeof fetch = () => Promise.reject(new TypeError('offline'));
    await expect(clientFor(offline).call(MoodleFunction.SiteInfo)).rejects.toThrow('Could not reach Moodle');
  });

  it('refuses functions that are not allow-listed', async () => {
    const moodle = fakeMoodle(() => ({}));
    await expect(clientFor(moodle.fetch).call('core_user_update_users' as MoodleFunction)).rejects.toThrow(
      /not allow-listed/,
    );
    expect(moodle.calls).toHaveLength(0);
  });

  it('never logs the token or parameter values', async () => {
    const lines: string[] = [];
    const logger = createLogger('debug', (_l, line) => lines.push(line));
    const moodle = fakeMoodle(() => ({ exception: 'x', errorcode: 'e', message: 'm' }));
    const client = new MoodleClient({
      baseUrl: TEST_SITE,
      token: 'SECRET-TOKEN',
      fetch: moodle.fetch,
      logger,
    });

    await client
      .call(MoodleFunction.SearchCourses, { criteriavalue: 'PRIVATE-QUERY' })
      .catch(() => undefined);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toMatch(/SECRET-TOKEN|PRIVATE-QUERY/);
  });
});

describe('MoodleClient fetch handling', () => {
  it('calls fetch as a plain function, never as a method of the client', async () => {
    // Workers throws "Illegal invocation" if the global fetch is called with another `this`.
    const strictFetch = function (this: unknown): Promise<Response> {
      if (this !== undefined) return Promise.reject(new TypeError('Illegal invocation'));
      return Promise.resolve(Response.json({ ok: true }));
    } as unknown as typeof fetch;

    await expect(clientFor(strictFetch).call(MoodleFunction.SiteInfo)).resolves.toEqual({ ok: true });
  });
});

describe('MoodleClient.userId', () => {
  it('looks the user up once', async () => {
    const moodle = fakeMoodle(() => ({ userid: 42 }));
    const client = clientFor(moodle.fetch);
    expect(await client.userId()).toBe(42);
    expect(await client.userId()).toBe(42);
    expect(moodle.calls).toHaveLength(1);
  });
});

describe('MoodleClient.download', () => {
  const FILE = `${TEST_SITE}/webservice/pluginfile.php/1/mod_resource/content/1/notes.txt`;
  const respond = (body: BodyInit, headers: Record<string, string> = {}) =>
    fakeMoodle(() => new Response(body, { headers: { 'Content-Type': 'text/plain', ...headers } }));

  it('fetches the file with the token and reports its type and name', async () => {
    const moodle = respond('hello');
    const file = await clientFor(moodle.fetch, 'tok').download(FILE, { maxBytes: 1024 });

    expect(new TextDecoder().decode(file.bytes)).toBe('hello');
    expect(file).toMatchObject({ mimeType: 'text/plain', filename: 'notes.txt', skipped: false });
    expect(moodle.calls[0]?.url.searchParams.get('token')).toBe('tok');
    expect(moodle.calls[0]?.headers.get('User-Agent')).toBe(USER_AGENT);
  });

  it('prefers the file name from Content-Disposition', async () => {
    const moodle = respond('x', { 'Content-Disposition': 'inline; filename="Sk%C5%82ad.txt"' });
    expect((await clientFor(moodle.fetch).download(FILE, { maxBytes: 1024 })).filename).toBe('Skład.txt');
  });

  it('never calls out for a URL on another host', async () => {
    const moodle = respond('x');
    await expect(
      clientFor(moodle.fetch).download('https://evil.example.org/2025/webservice/pluginfile.php/1/a', {
        maxBytes: 1024,
      }),
    ).rejects.toThrow(/same Moodle site/);
    expect(moodle.calls).toHaveLength(0);
  });

  it('does not follow redirects, so the token cannot be forwarded', async () => {
    let init: RequestInit | undefined;
    const fetchImpl: typeof fetch = (_input, options) => {
      init = options;
      return Promise.resolve(
        new Response(null, { status: 302, headers: { Location: 'https://evil.example.org/' } }),
      );
    };
    await expect(clientFor(fetchImpl).download(FILE, { maxBytes: 1024 })).rejects.toThrow(/HTTP 302/);
    expect(init?.redirect).toBe('manual');
  });

  it('turns a JSON error body into a MoodleError', async () => {
    const moodle = fakeMoodle(() => ({ error: 'File not found', errorcode: 'filenotfound' }));
    await expect(clientFor(moodle.fetch).download(FILE, { maxBytes: 1024 })).rejects.toMatchObject({
      name: 'MoodleError',
      message: 'filenotfound: File not found',
    });
  });

  it('refuses files over the limit, declared or not', async () => {
    await expect(
      clientFor(respond('x', { 'Content-Length': '5000' }).fetch).download(FILE, { maxBytes: 1024 }),
    ).rejects.toThrow(/too large/);
    const undeclared = fakeMoodle(() => new Response(new Uint8Array(4096)));
    await expect(clientFor(undeclared.fetch).download(FILE, { maxBytes: 1024 })).rejects.toThrow(/too large/);
  });

  it('skips the body when the filter refuses the file', async () => {
    const moodle = respond('x'.repeat(100), { 'Content-Type': 'video/mp4' });
    const file = await clientFor(moodle.fetch).download(FILE, {
      maxBytes: 1024,
      accept: ({ mimeType }) => mimeType !== 'video/mp4',
    });
    expect(file).toMatchObject({ skipped: true, mimeType: 'video/mp4' });
    expect(file.bytes).toHaveLength(0);
  });

  it('reads the rest of a body only when a peek at its start says so', async () => {
    const text = respond('x'.repeat(20_000), { 'Content-Type': 'application/octet-stream' });
    const kept = await clientFor(text.fetch).download(FILE, {
      maxBytes: 1024 * 1024,
      accept: () => 'peek',
      peek: (head) => head[0] === 120,
    });
    expect(kept).toMatchObject({ skipped: false });
    expect(kept.bytes).toHaveLength(20_000);

    const refused = await clientFor(text.fetch).download(FILE, {
      maxBytes: 1024 * 1024,
      accept: () => 'peek',
      peek: () => false,
    });
    expect(refused).toMatchObject({ skipped: true });
    expect(refused.bytes).toHaveLength(0);

    const short = await clientFor(respond('abc').fetch).download(FILE, {
      maxBytes: 1024,
      accept: () => 'peek',
      peek: (head) => head.length === 3,
    });
    expect(short).toMatchObject({ skipped: false });
  });

  it('never logs the token or the URL', async () => {
    const lines: string[] = [];
    const logger = createLogger('debug', (_l, line) => lines.push(line));
    const ok = new MoodleClient({
      baseUrl: TEST_SITE,
      token: 'SECRET-TOKEN',
      fetch: respond('x').fetch,
      logger,
    });
    await ok.download(FILE, { maxBytes: 1024 });
    const bad = new MoodleClient({
      baseUrl: TEST_SITE,
      token: 'SECRET-TOKEN',
      fetch: () => Promise.reject(new TypeError('offline')),
      logger,
    });
    await bad.download(FILE, { maxBytes: 1024 }).catch(() => undefined);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toMatch(/SECRET-TOKEN|notes\.txt|pluginfile/);
  });

  it('calls fetch as a plain function', async () => {
    const strictFetch = function (this: unknown): Promise<Response> {
      if (this !== undefined) return Promise.reject(new TypeError('Illegal invocation'));
      return Promise.resolve(new Response('ok', { headers: { 'Content-Type': 'text/plain' } }));
    } as unknown as typeof fetch;
    await expect(clientFor(strictFetch).download(FILE, { maxBytes: 1024 })).resolves.toMatchObject({
      skipped: false,
    });
  });
});

describe('MoodleClient logging', () => {
  const FILE = `${TEST_SITE}/webservice/pluginfile.php/1/mod_resource/content/1/notes.txt`;

  function logged(fetchImpl: typeof fetch) {
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger('debug', (_l, line) =>
      lines.push(JSON.parse(line) as Record<string, unknown>),
    );
    return {
      lines,
      client: new MoodleClient({ baseUrl: TEST_SITE, token: 'tok', fetch: fetchImpl, logger }),
    };
  }

  it('logs a call with its function, outcome and time, tagged with the site', async () => {
    const { lines, client } = logged(fakeMoodle(() => ({ ok: 1 })).fetch);
    await client.call(MoodleFunction.SiteInfo);
    expect(lines[0]).toMatchObject({
      level: 'info',
      site: TEST_SITE,
      function: MoodleFunction.SiteInfo,
      endpoint: '/webservice/rest/server.php',
      ok: true,
    });
    expect(lines[0]?.msg).toMatch(new RegExp(`^moodle ${MoodleFunction.SiteInfo} ok \\d+ms$`));
    expect(typeof lines[0]?.ms).toBe('number');
  });

  it('logs a failed call as a warning with the reason', async () => {
    const offline: typeof fetch = () => Promise.reject(new TypeError('offline'));
    const { lines, client } = logged(offline);
    await client.call(MoodleFunction.SiteInfo).catch(() => undefined);
    expect(lines[0]).toMatchObject({
      level: 'warn',
      function: MoodleFunction.SiteInfo,
      ok: false,
      error: expect.stringMatching(/Could not reach Moodle/) as unknown,
      cause: 'offline',
    });
    expect(lines[0]?.msg).toMatch(new RegExp(`^moodle ${MoodleFunction.SiteInfo} failed \\d+ms$`));
  });

  it('logs a download with its type and size', async () => {
    const moodle = fakeMoodle(() => new Response('hello', { headers: { 'Content-Type': 'text/plain' } }));
    const { lines, client } = logged(moodle.fetch);
    await client.download(FILE, { maxBytes: 1024 });
    expect(lines[0]).toMatchObject({ level: 'info', ok: true, skipped: false, mime: 'text/plain', bytes: 5 });
    expect(lines[0]?.msg).toMatch(/^moodle download text\/plain 5 bytes \d+ms$/);
  });

  it('logs a failed download as a warning with the reason', async () => {
    const moodle = fakeMoodle(() => new Response('x', { headers: { 'Content-Length': '5000' } }));
    const { lines, client } = logged(moodle.fetch);
    await client.download(FILE, { maxBytes: 1024 }).catch(() => undefined);
    expect(lines[0]).toMatchObject({
      level: 'warn',
      ok: false,
      error: expect.stringMatching(/too large/) as unknown,
    });
    expect(lines[0]?.msg).toMatch(/^moodle download failed \d+ms$/);
  });
});

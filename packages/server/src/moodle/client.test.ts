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
    const file = await clientFor(moodle.fetch, 'tok').download(FILE, 1024);

    expect(new TextDecoder().decode(file.bytes)).toBe('hello');
    expect(file).toMatchObject({ mimeType: 'text/plain', filename: 'notes.txt', skipped: false });
    expect(moodle.calls[0]?.url.searchParams.get('token')).toBe('tok');
    expect(moodle.calls[0]?.headers.get('User-Agent')).toBe(USER_AGENT);
  });

  it('prefers the file name from Content-Disposition', async () => {
    const moodle = respond('x', { 'Content-Disposition': 'inline; filename="Sk%C5%82ad.txt"' });
    expect((await clientFor(moodle.fetch).download(FILE, 1024)).filename).toBe('Skład.txt');
  });

  it('never calls out for a URL on another host', async () => {
    const moodle = respond('x');
    await expect(
      clientFor(moodle.fetch).download('https://evil.example.org/2025/webservice/pluginfile.php/1/a', 1024),
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
    await expect(clientFor(fetchImpl).download(FILE, 1024)).rejects.toThrow(/HTTP 302/);
    expect(init?.redirect).toBe('manual');
  });

  it('turns a JSON error body into a MoodleError', async () => {
    const moodle = fakeMoodle(() => ({ error: 'File not found', errorcode: 'filenotfound' }));
    await expect(clientFor(moodle.fetch).download(FILE, 1024)).rejects.toMatchObject({
      name: 'MoodleError',
      message: 'filenotfound: File not found',
    });
  });

  it('refuses files over the limit, declared or not', async () => {
    await expect(
      clientFor(respond('x', { 'Content-Length': '5000' }).fetch).download(FILE, 1024),
    ).rejects.toThrow(/too large/);
    const undeclared = fakeMoodle(() => new Response(new Uint8Array(4096)));
    await expect(clientFor(undeclared.fetch).download(FILE, 1024)).rejects.toThrow(/too large/);
  });

  it('skips the body when the filter refuses the file', async () => {
    const moodle = respond('x'.repeat(100), { 'Content-Type': 'video/mp4' });
    const file = await clientFor(moodle.fetch).download(
      FILE,
      1024,
      ({ mimeType }) => mimeType !== 'video/mp4',
    );
    expect(file).toMatchObject({ skipped: true, mimeType: 'video/mp4' });
    expect(file.bytes).toHaveLength(0);
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
    await ok.download(FILE, 1024);
    const bad = new MoodleClient({
      baseUrl: TEST_SITE,
      token: 'SECRET-TOKEN',
      fetch: () => Promise.reject(new TypeError('offline')),
      logger,
    });
    await bad.download(FILE, 1024).catch(() => undefined);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toMatch(/SECRET-TOKEN|notes\.txt|pluginfile/);
  });

  it('calls fetch as a plain function', async () => {
    const strictFetch = function (this: unknown): Promise<Response> {
      if (this !== undefined) return Promise.reject(new TypeError('Illegal invocation'));
      return Promise.resolve(new Response('ok', { headers: { 'Content-Type': 'text/plain' } }));
    } as unknown as typeof fetch;
    await expect(clientFor(strictFetch).download(FILE, 1024)).resolves.toMatchObject({ skipped: false });
  });
});

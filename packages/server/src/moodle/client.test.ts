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

import { describe, expect, it } from 'vitest';

import { MoodleTransportError } from './errors.ts';
import { ensureOk, send } from './http.ts';

describe('send', () => {
  it('passes the request through', async () => {
    const response = new Response('ok');
    expect(await send(() => Promise.resolve(response), 'https://moodle.example/x')).toBe(response);
  });

  it('turns a network failure into a transport error that keeps the cause', async () => {
    const cause = new TypeError('fetch failed');
    const error = await send(() => Promise.reject(cause), 'https://moodle.example/x').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MoodleTransportError);
    expect((error as Error).cause).toBe(cause);
  });
});

describe('ensureOk', () => {
  it('returns a successful response', () => {
    const response = new Response('ok');
    expect(ensureOk(response)).toBe(response);
  });

  it('throws a transport error with the status for a failure', () => {
    expect(() => ensureOk(new Response('nope', { status: 503 }))).toThrow(
      new MoodleTransportError('Moodle returned HTTP 503'),
    );
  });
});

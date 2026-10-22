import { MoodleTransportError } from './errors.ts';

/**
 * Sends one request with `doFetch`, turning a network failure into a transport error. `doFetch` is called as a
 * plain function: Workers rejects the global fetch invoked with any other `this`.
 */
export async function send(doFetch: typeof fetch, url: string | URL, init?: RequestInit): Promise<Response> {
  try {
    return await doFetch(url, init);
  } catch (cause) {
    throw new MoodleTransportError('Could not reach Moodle', { cause });
  }
}

/** Returns the response, or throws a transport error when Moodle answered with a failure status. */
export function ensureOk(response: Response): Response {
  if (!response.ok) throw new MoodleTransportError(`Moodle returned HTTP ${response.status}`);
  return response;
}

import { type Logger, silentLogger } from '../logger.ts';
import { MoodleError, MoodleTransportError } from './errors.ts';
import { isAllowedFunction, MoodleFunction } from './functions.ts';

/** Moodle must see a "MoodleMobile" user agent for the QR login exchange; we use it everywhere. */
export const USER_AGENT = 'MoodleMobile/4.5.0 (moodle-mcp)';

const MAX_RESPONSE_CHARS = 16 * 1024 * 1024;

export type Params = Record<string, string | number>;

export interface MoodleClientOptions {
  /** Base URL of the Moodle site, e.g. https://host/2025. */
  baseUrl: string;
  /** The user's web service token. */
  token: string;
  fetch?: typeof fetch;
  logger?: Logger;
}

interface ExceptionBody {
  exception: string;
  errorcode: string;
  message: string;
}

const isExceptionBody = (v: unknown): v is ExceptionBody =>
  typeof v === 'object' && v !== null && 'exception' in v && 'errorcode' in v && 'message' in v;

/** Read-only client for one token owner. Cheap to create; create one per request. */
export class MoodleClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #log: Logger;
  #userId: number | undefined;

  constructor(options: MoodleClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
    this.#log = options.logger ?? silentLogger;
  }

  /** Calls an allow-listed web service function and returns its parsed JSON result. */
  async call<T = unknown>(fn: MoodleFunction, params: Params = {}): Promise<T> {
    if (!isAllowedFunction(fn)) throw new Error(`Moodle function is not allow-listed: ${String(fn)}`);

    const started = Date.now();
    try {
      const body = new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)] as [string, string]),
      );
      body.set('wstoken', this.#token);
      body.set('wsfunction', fn);
      body.set('moodlewsrestformat', 'json');

      const result = await this.#post<T>(`${this.#baseUrl}/webservice/rest/server.php`, body);
      this.#log.debug('moodle call', { function: fn, ms: Date.now() - started });
      return result;
    } catch (error) {
      // Never log the token or parameter values; they identify the user.
      this.#log.warn('moodle call failed', {
        function: fn,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined,
      });
      throw error;
    }
  }

  /** The token owner's user id, looked up once per client. */
  async userId(): Promise<number> {
    if (this.#userId === undefined) {
      const info = await this.call<{ userid: number }>(MoodleFunction.SiteInfo);
      this.#userId = info.userid;
    }
    return this.#userId;
  }

  async #post<T>(url: string, body: URLSearchParams): Promise<T> {
    // Called as a plain function: Workers rejects the global fetch invoked with any other `this`.
    const doFetch = this.#fetch;
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body,
      });
    } catch (cause) {
      throw new MoodleTransportError('Could not reach Moodle', { cause });
    }
    return parseMoodleResponse<T>(response);
  }
}

/** Decodes a Moodle response, turning HTTP failures and in-body exceptions into errors. */
export async function parseMoodleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new MoodleTransportError(`Moodle returned HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new MoodleTransportError('Moodle response is too large');

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new MoodleTransportError('Moodle returned a non-JSON response', { cause });
  }
  if (isExceptionBody(data)) throw new MoodleError(data.errorcode, data.message);
  return data as T;
}

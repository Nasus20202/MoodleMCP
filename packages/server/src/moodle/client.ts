import { type Logger, silentLogger } from '../logger.ts';
import { MoodleError, MoodleTransportError } from './errors.ts';
import { resolveFileUrl } from './file-url.ts';
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

const WS_ENDPOINT = '/webservice/rest/server.php';

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
    // The base URL is a validated site address (https, no credentials or query), so it is safe to log.
    this.#log = (options.logger ?? silentLogger).child({ site: this.#baseUrl });
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

      const result = await this.#post<T>(`${this.#baseUrl}${WS_ENDPOINT}`, body);
      const ms = Date.now() - started;
      this.#log.info(`moodle ${fn} ok ${ms}ms`, { function: fn, endpoint: WS_ENDPOINT, ok: true, ms });
      return result;
    } catch (error) {
      // Never log the token or parameter values; they identify the user.
      const ms = Date.now() - started;
      this.#log.warn(`moodle ${fn} failed ${ms}ms`, {
        function: fn,
        endpoint: WS_ENDPOINT,
        ok: false,
        ms,
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

  /**
   * Downloads a file the token owner may read (a read-only GET). `fileUrl` must be on this site's
   * file server; redirects are refused so the token cannot be forwarded elsewhere.
   */
  async download(fileUrl: string, maxBytes: number, accept?: FileFilter): Promise<DownloadedFile> {
    const url = resolveFileUrl(this.#baseUrl, fileUrl, this.#token);
    const started = Date.now();
    try {
      const file = await this.#get(url, maxBytes, accept);
      const ms = Date.now() - started;
      const bytes = file.bytes.byteLength;
      this.#log.info(`moodle download ${file.mimeType} ${bytes} bytes ${ms}ms`, {
        ok: true,
        skipped: file.skipped,
        mime: file.mimeType,
        bytes,
        ms,
      });
      return file;
    } catch (error) {
      // The URL carries the token, so it is never logged.
      const ms = Date.now() - started;
      this.#log.warn(`moodle download failed ${ms}ms`, {
        ok: false,
        ms,
        error: error instanceof Error ? error.message : String(error),
        cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined,
      });
      throw error;
    }
  }

  async #get(url: URL, maxBytes: number, accept?: FileFilter): Promise<DownloadedFile> {
    const doFetch = this.#fetch;
    let response: Response;
    try {
      response = await doFetch(url, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT } });
    } catch (cause) {
      throw new MoodleTransportError('Could not reach Moodle', { cause });
    }
    if (!response.ok) throw new MoodleTransportError(`Moodle returned HTTP ${response.status} for the file`);

    const mimeType = (response.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    const filename = filenameOf(response, url);
    // Don't pull down what the caller has no use for.
    if (accept && !accept({ mimeType, filename })) {
      await response.body?.cancel();
      return { bytes: new Uint8Array(), mimeType, filename, skipped: true };
    }
    const declared = Number(response.headers.get('Content-Length'));
    if (declared > maxBytes) throw tooLarge(declared, maxBytes);

    const bytes = await readLimited(response, maxBytes);
    // Moodle reports a missing or forbidden file as a JSON body with status 200.
    if (mimeType === 'application/json' && bytes.byteLength < 64 * 1024) {
      const body = safeJson(bytes);
      if (typeof body === 'object' && body !== null && 'errorcode' in body) {
        const { errorcode, error, message } = body as Record<string, string | undefined>;
        throw new MoodleError(String(errorcode), error ?? message ?? 'File could not be read');
      }
    }
    return { bytes, mimeType, filename, skipped: false };
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

export interface DownloadedFile {
  bytes: Uint8Array;
  /** Lower-case media type without parameters; empty when the server sent none. */
  mimeType: string;
  filename: string;
  /** True when `accept` refused the file, in which case `bytes` is empty. */
  skipped: boolean;
}

/** Decides from the response headers alone whether the body is worth downloading. */
export type FileFilter = (meta: Pick<DownloadedFile, 'mimeType' | 'filename'>) => boolean;

const tooLarge = (size: number, max: number) =>
  new MoodleTransportError(
    `File is too large to read (${Math.round(size / 1024 / 1024)} MB; the limit is ${Math.round(max / 1024 / 1024)} MB)`,
  );

/** Reads the body, giving up as soon as it exceeds `maxBytes` (Content-Length may be absent or wrong). */
async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = (await reader.read()) as ReadableStreamReadResult<Uint8Array>;
    if (result.done) break;
    const value = result.value;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge(total, maxBytes);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

const safeJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
};

function filenameOf(response: Response, url: URL): string {
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
  const raw = named ?? url.pathname.split('/').pop() ?? 'file';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
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

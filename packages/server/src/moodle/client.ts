import { type LogFields, type Logger, silentLogger } from '../logger.ts';
import { MoodleError, MoodleTransportError } from './errors.ts';
import { resolveFileUrl } from './file-url.ts';
import { isAllowedFunction, MoodleFunction } from './functions.ts';
import { ensureOk, send } from './http.ts';

/** Moodle must see a "MoodleMobile" user agent for the QR login exchange; we use it everywhere. */
export const USER_AGENT = 'MoodleMobile/4.5.0 (moodle-mcp)';

const MAX_RESPONSE_CHARS = 16 * 1024 * 1024;

/** The part of `core_webservice_get_site_info` the client itself needs. */
interface SiteInfo {
  userid: number;
  lang?: string;
}

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
  /** Absent for PHP errors, which Moodle reports as just `{exception, message}`. */
  errorcode?: string;
  message: string;
}

const isExceptionBody = (v: unknown): v is ExceptionBody =>
  typeof v === 'object' && v !== null && 'exception' in v && 'message' in v;

/** Log fields that say why a call failed. Messages only: they never carry the token or parameter values. */
function failureFields(error: unknown) {
  return {
    error: error instanceof Error ? error.message : String(error),
    cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined,
  };
}

/** Read-only client for one token owner. Cheap to create; create one per request. */
export class MoodleClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #log: Logger;
  #siteInfo: Promise<SiteInfo> | undefined;

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

    const body = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)] as [string, string]),
    );
    body.set('wstoken', this.#token);
    body.set('wsfunction', fn);
    body.set('moodlewsrestformat', 'json');
    return this.#logged(fn, { function: fn, endpoint: WS_ENDPOINT }, () =>
      this.#post<T>(`${this.#baseUrl}${WS_ENDPOINT}`, body),
    );
  }

  /** The token owner's user id, looked up once per client. */
  async userId(): Promise<number> {
    return (await this.#info()).userid;
  }

  /** The token owner's interface language (e.g. `pl`), to pick a part of multi-language text. */
  async lang(): Promise<string> {
    return (await this.#info()).lang ?? 'en';
  }

  #info(): Promise<SiteInfo> {
    this.#siteInfo ??= this.call<SiteInfo>(MoodleFunction.SiteInfo).catch((error: unknown) => {
      this.#siteInfo = undefined; // a failed lookup must not be remembered
      throw error;
    });
    return this.#siteInfo;
  }

  /**
   * Downloads a file the token owner may read (a read-only GET). `fileUrl` must be on this site's
   * file server; redirects are refused so the token cannot be forwarded elsewhere.
   */
  async download(fileUrl: string, options: DownloadOptions): Promise<DownloadedFile> {
    const url = resolveFileUrl(this.#baseUrl, fileUrl, this.#token);
    // The URL carries the token, so it is never logged.
    return this.#logged(
      'download',
      {},
      () => this.#get(url, options),
      (file) => ({
        summary: `${file.mimeType} ${file.bytes.byteLength} bytes`,
        fields: { skipped: file.skipped, mime: file.mimeType, bytes: file.bytes.byteLength },
      }),
    );
  }

  /**
   * Runs `request`, logging its outcome and time. A failure is logged by its message only, which never
   * carries the token or parameter values.
   */
  async #logged<T>(
    name: string,
    fields: LogFields,
    request: () => Promise<T>,
    describe: (result: T) => { summary: string; fields: LogFields } = () => ({ summary: 'ok', fields: {} }),
  ): Promise<T> {
    const started = Date.now();
    try {
      const result = await request();
      const ms = Date.now() - started;
      const outcome = describe(result);
      this.#log.info(`moodle ${name} ${outcome.summary} ${ms}ms`, {
        ...fields,
        ok: true,
        ...outcome.fields,
        ms,
      });
      return result;
    } catch (error) {
      const ms = Date.now() - started;
      this.#log.warn(`moodle ${name} failed ${ms}ms`, { ...fields, ok: false, ms, ...failureFields(error) });
      throw error;
    }
  }

  async #get(url: URL, { maxBytes, accept, peek }: DownloadOptions): Promise<DownloadedFile> {
    const response = await send(this.#fetch, url, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) throw new MoodleTransportError(`Moodle returned HTTP ${response.status} for the file`);

    const mimeType = (response.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    const filename = filenameOf(response, url);
    // Don't pull down what the caller has no use for.
    const verdict = accept ? accept({ mimeType, filename }) : true;
    if (verdict === false) {
      await response.body?.cancel();
      return { bytes: new Uint8Array(), mimeType, filename, skipped: true };
    }
    const declared = Number(response.headers.get('Content-Length'));
    if (declared > maxBytes) throw tooLarge(declared, maxBytes);

    const bytes = await readLimited(response, maxBytes, verdict === 'peek' ? peek : undefined);
    if (bytes === null) return { bytes: new Uint8Array(), mimeType, filename, skipped: true };
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
    const response = await send(this.#fetch, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body,
    });
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

export interface DownloadOptions {
  /** Larger files are refused, before or while reading them. */
  maxBytes: number;
  /** Looks at the headers first: a file it refuses is not downloaded. */
  accept?: FileFilter | undefined;
  /** Decides for a file `accept` answered `'peek'` for; without it, such a file is read whole. */
  peek?: PeekFilter | undefined;
}

/** Decides from the response headers alone whether the body is worth downloading. */
export type FileFilter = (meta: Pick<DownloadedFile, 'mimeType' | 'filename'>) => boolean | 'peek';

/** Decides from the first bytes of a body whether to read the rest (for a `'peek'` verdict). */
export type PeekFilter = (head: Uint8Array) => boolean;

/** How much of a body is looked at before a `PeekFilter` decides. */
export const PEEK_BYTES = 8192;

const tooLarge = (size: number, max: number) =>
  new MoodleTransportError(
    `File is too large to read (${Math.round(size / 1024 / 1024)} MB; the limit is ${Math.round(max / 1024 / 1024)} MB)`,
  );

/**
 * Reads the body, giving up as soon as it exceeds `maxBytes` (Content-Length may be absent or wrong). With
 * `peek`, the first `PEEK_BYTES` are shown to it and the rest is left unread, returning null, if it says no.
 */
async function readLimited(
  response: Response,
  maxBytes: number,
  peek?: PeekFilter,
): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let pending = peek;
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
    if (pending && total >= PEEK_BYTES) {
      if (!pending(concat(chunks, total))) {
        await reader.cancel();
        return null;
      }
      pending = undefined;
    }
  }
  if (pending && !pending(concat(chunks, total))) return null;
  return concat(chunks, total);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
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

/** PHP errors (not Moodle's own exceptions) carry internals such as "Call to a member function … on null". */
const PHP_ERROR = /^(Error|TypeError|ValueError|ArgumentCountError|DivisionByZeroError|dml_\w+)$/;

function toMoodleError({ exception, errorcode, message }: ExceptionBody): MoodleError {
  // Moodle's own exceptions always have an error code; a PHP error of any class has none.
  const code = errorcode === undefined || errorcode === '' ? 'unknown' : errorcode;
  if (
    code === 'unknown' ||
    PHP_ERROR.test(exception) ||
    code === 'generalexceptionmessage' ||
    code === 'codingerror'
  )
    return new MoodleError(
      code,
      'Moodle could not process this request. Most likely an id does not exist or the user cannot access it.',
    );
  return new MoodleError(code, message);
}

/** Decodes a Moodle response, turning HTTP failures and in-body exceptions into errors. */
export async function parseMoodleResponse<T>(response: Response): Promise<T> {
  const text = await ensureOk(response).text();
  if (text.length > MAX_RESPONSE_CHARS) throw new MoodleTransportError('Moodle response is too large');

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new MoodleTransportError('Moodle returned a non-JSON response', { cause });
  }
  if (isExceptionBody(data)) throw toMoodleError(data);
  return data as T;
}

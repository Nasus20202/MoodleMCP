import * as z from 'zod/v4';

import { fromBase64Url, toBase64Url } from './encoding.ts';

const PREFIX = 'mm1.';
const IV_BYTES = 12;

const envelope = z.object({ exp: z.number().optional() }).loose();

/**
 * Seals small JSON payloads into opaque, tamper-proof strings (AES-256-GCM). This is what keeps the OAuth
 * flow stateless: client ids, authorization codes and access/refresh tokens are not looked up anywhere,
 * they carry their own contents, readable only with the server's secret.
 *
 * The `kind` is authenticated along with the payload, so e.g. an access token cannot be replayed as a
 * refresh token.
 */
export class Sealer {
  readonly #secret: string;
  readonly #now: () => number;
  #key: Promise<CryptoKey> | undefined;

  constructor(secret: string, now: () => number = Date.now) {
    this.#secret = secret;
    this.#now = now;
  }

  /** The AES key, derived from the secret on first use. */
  #cryptoKey(): Promise<CryptoKey> {
    this.#key ??= crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(this.#secret))
      .then((material) => crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']));
    return this.#key;
  }

  /** True for strings that look like ours, so raw Moodle tokens are never mistaken for them. */
  static isSealed(value: string): boolean {
    return value.startsWith(PREFIX);
  }

  /** Seals `data`; without `ttlSeconds` the result never expires. */
  async seal(kind: string, data: object, ttlSeconds?: number): Promise<string> {
    const exp = ttlSeconds === undefined ? undefined : Math.floor(this.#now() / 1000) + ttlSeconds;
    const plain = new TextEncoder().encode(JSON.stringify({ ...data, exp }));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(kind) },
      await this.#cryptoKey(),
      plain,
    );
    return PREFIX + toBase64Url(new Uint8Array([...iv, ...new Uint8Array(cipher)]));
  }

  /** The payload if `value` is an intact, unexpired seal of this `kind` whose contents match `schema`. */
  async open<S extends z.ZodType>(kind: string, value: string, schema: S): Promise<z.output<S> | undefined> {
    const bytes = value.startsWith(PREFIX) ? fromBase64Url(value.slice(PREFIX.length)) : undefined;
    if (!bytes || bytes.length <= IV_BYTES) return undefined;
    try {
      const plain = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: bytes.slice(0, IV_BYTES),
          additionalData: new TextEncoder().encode(kind),
        },
        await this.#cryptoKey(),
        bytes.slice(IV_BYTES),
      );
      const json: unknown = JSON.parse(new TextDecoder().decode(plain));
      const { exp } = envelope.parse(json);
      if (exp !== undefined && exp * 1000 <= this.#now()) return undefined;
      const parsed = schema.safeParse(json);
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }
}

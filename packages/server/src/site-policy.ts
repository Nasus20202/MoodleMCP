import { normalizeSite } from '@moodle-mcp/shared';

import { ANY_HOST, type AppConfig } from './config.ts';

/** A caller asked for a site this server will not talk to. The message is safe to show. */
export class SiteNotAllowedError extends Error {
  override name = 'SiteNotAllowedError';
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal'];

/**
 * Decides which Moodle sites a caller may point the server at. Without it, a caller-supplied URL
 * would turn the Worker into an open HTTP proxy.
 */
export class SitePolicy {
  readonly defaultUrl: string;
  readonly #allowedHosts: ReadonlySet<string>;
  readonly #allowAny: boolean;
  readonly #insecure: boolean;

  constructor(config: Pick<AppConfig, 'moodleUrl' | 'allowedHosts' | 'allowInsecureSites'>) {
    this.defaultUrl = normalizeSite(config.moodleUrl);
    this.#insecure = config.allowInsecureSites;
    this.#allowAny = config.allowedHosts.includes(ANY_HOST);
    const hosts = config.allowedHosts.filter((h) => h !== ANY_HOST);
    // Secure default: when nothing is listed, only the configured site's own host is allowed.
    this.#allowedHosts = new Set(
      hosts.length > 0 ? hosts : [new URL(this.defaultUrl).hostname.toLowerCase()],
    );
  }

  /** Normalises a caller-supplied site URL or throws SiteNotAllowedError. */
  validate(raw: string): string {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new SiteNotAllowedError('Invalid Moodle URL');
    }
    const secure = url.protocol === 'https:' || (this.#insecure && url.protocol === 'http:');
    if (!secure) throw new SiteNotAllowedError('Moodle URL must use https');
    if (url.username || url.password || url.search || url.hash) {
      throw new SiteNotAllowedError('Moodle URL must not contain credentials, query or fragment');
    }
    if (!(this.#insecure || isPublicHostname(url.hostname))) {
      throw new SiteNotAllowedError('Moodle URL must be a public hostname');
    }
    if (!(this.#allowAny || this.#allowedHosts.has(url.hostname.toLowerCase()))) {
      throw new SiteNotAllowedError('This Moodle site is not allowed on this server');
    }
    return normalizeSite(url.toString());
  }

  /** The site for a request: the caller's choice if given (and allowed), else the default. */
  resolve(requested: string | null | undefined): string {
    const raw = requested?.trim();
    return raw ? this.validate(raw) : this.defaultUrl;
  }
}

function isPublicHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (!h.includes('.') || h === 'localhost' || h.startsWith('[') || IPV4.test(h)) return false;
  return !PRIVATE_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

import { MOODLE_MOBILE_SERVICE, MOODLE_URL_SCHEME } from './constants.ts';
import { normalizeSite } from './site.ts';

/** Raised for input that is not a usable Moodle app link. Safe to show to users. */
export class LinkError extends Error {
  override name = 'LinkError';
}

/** What a scanned QR code or pasted link contains. */
export const QRKind = {
  /** moodlemobile://token=… (result of a browser login) */
  Token: 'token',
  /** moodlemobile://site?qrlogin=KEY&userid=ID (one-time login key) */
  QRLogin: 'qrlogin',
  /** Just the site address: no credentials in it. */
  SiteOnly: 'site-only',
  Unknown: 'unknown',
} as const;
export type QRKind = (typeof QRKind)[keyof typeof QRKind];

/** The content of a Moodle app QR code with a login key. */
export interface QrLogin {
  site: string;
  key: string;
  userId: number;
}

const TOKEN_PARAM = 'token=';
const PASSPORT_BYTES = 8;
const URL_PREFIX = /^(moodlemobile|https?):\/\//;

/** Decide what a decoded QR code (or pasted text) contains. */
export function classifyLink(text: string): QRKind {
  const s = text.trim();
  if (s.includes('://token=')) return QRKind.Token;
  if (/[?&]qrlogin=/.test(s)) return QRKind.QRLogin;
  if (URL_PREFIX.test(s)) return QRKind.SiteOnly;
  return QRKind.Unknown;
}

/** Extract the web service token from moodlemobile://token=BASE64(siteid:::token[:::privatetoken]). */
export function decodeLaunchToken(input: string): string {
  const i = input.indexOf(TOKEN_PARAM);
  if (i < 0) throw new LinkError('That does not look like a moodlemobile://token=… link.');

  let encoded = input.slice(i + TOKEN_PARAM.length).trim();
  try {
    encoded = decodeURIComponent(encoded);
  } catch {
    // not percent-encoded; use as is
  }

  let raw: string;
  try {
    raw = atob(encoded);
  } catch {
    throw new LinkError('The token link is not valid base64.');
  }
  const token = raw.split(':::')[1];
  if (!token) throw new LinkError('Unexpected token payload.');
  return token;
}

/** Parse moodlemobile://<site>?qrlogin=KEY&userid=ID (the scheme may be customised by the site). */
export function parseQrLogin(text: string): QrLogin {
  let s = text.trim();
  const schemeEnd = s.indexOf('://');
  if (schemeEnd >= 0 && !s.startsWith('http')) s = s.slice(schemeEnd + 3);

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new LinkError('Not a Moodle QR login URL.');
  }
  const key = url.searchParams.get('qrlogin');
  const userId = Number.parseInt(url.searchParams.get('userid') ?? '', 10);
  if (!key || !Number.isInteger(userId) || userId <= 0) {
    throw new LinkError('QR code has no login key; the site must use "QR code with automatic login".');
  }
  url.search = '';
  url.hash = '';
  return { site: normalizeSite(url.toString()), key, userId };
}

/**
 * URL that starts a browser (SSO) login. confirmed=1 makes Moodle render a page with the
 * moodlemobile://token=… link instead of a bare redirect, which a browser would silently fail to
 * follow, leaving nothing to copy.
 */
export function launchUrl(site: string, passport = randomPassport()): string {
  const params = new URLSearchParams({
    service: MOODLE_MOBILE_SERVICE,
    passport,
    urlscheme: MOODLE_URL_SCHEME,
    confirmed: '1',
  });
  return `${normalizeSite(site)}/admin/tool/mobile/launch.php?${params}`;
}

function randomPassport(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PASSPORT_BYTES));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

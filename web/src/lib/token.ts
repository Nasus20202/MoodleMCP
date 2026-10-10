import { QRKind } from './types/token';

const TOKEN_PARAM = 'token=';
const PASSPORT_BYTES = 8;

/** Extract the web service token from moodlemobile://token=BASE64(siteid:::token[:::privatetoken]). */
export function decodeLaunchToken(input: string): string {
  const i = input.indexOf(TOKEN_PARAM);
  if (i < 0) throw new Error('That does not look like a moodlemobile://token=… link.');

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
    throw new Error('The token link is not valid base64.');
  }
  const token = raw.split(':::')[1];
  if (!token) throw new Error('Unexpected token payload.');
  return token;
}

/** Decide what a decoded QR code (or pasted text) contains. */
export function classify(text: string): QRKind {
  const s = text.trim();
  if (s.includes('://token=')) return QRKind.Token;
  if (/[?&]qrlogin=/.test(s)) return QRKind.QRLogin;
  if (/^(moodlemobile|https?):\/\//.test(s)) return QRKind.SiteOnly;
  return QRKind.Unknown;
}

/** URL that starts a browser (SSO) login and ends in a moodlemobile://token=… redirect. */
export function launchUrl(site: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PASSPORT_BYTES));
  const passport = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  // confirmed=1 makes Moodle render a page with the moodlemobile://token=… link instead of a bare
  // redirect, which a browser would silently fail to follow, leaving nothing to copy.
  const params = new URLSearchParams({ service: 'moodle_mobile_app', passport, urlscheme: 'moodlemobile', confirmed: '1' });
  return `${site}/admin/tool/mobile/launch.php?${params}`;
}

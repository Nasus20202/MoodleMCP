// Types for turning QR codes and pasted links into tokens.

/** What a scanned QR code or pasted link contains. */
export const QRKind = {
  /** moodlemobile://token=… (result of a browser login) */
  Token: 'token',
  /** moodlemobile://site?qrlogin=KEY&userid=ID (one-time login key) */
  QRLogin: 'qrlogin',
  /** Just the site address: no credentials in it. */
  SiteOnly: 'site-only',
  Unknown: 'unknown'
} as const;
export type QRKind = (typeof QRKind)[keyof typeof QRKind];

/** Outcome of turning user input into a token. */
export type Resolution = { status: 'token'; token: string } | { status: 'needs-browser-login' };

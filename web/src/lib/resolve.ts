import { exchangeQR } from './api';
import { classify, decodeLaunchToken } from './token';
import { QRKind, type Resolution } from './types/token';

/**
 * Turn whatever the user gave us (decoded QR text or a pasted link) into a token.
 * `exchange` is injectable for tests.
 */
export async function resolveToken(text: string, exchange: (qr: string) => Promise<string> = exchangeQR): Promise<Resolution> {
  switch (classify(text)) {
    case QRKind.Token:
      return { status: 'token', token: decodeLaunchToken(text) };
    case QRKind.QRLogin:
      return { status: 'token', token: await exchange(text) };
    case QRKind.SiteOnly:
      return { status: 'needs-browser-login' };
    default:
      throw new Error('That is not a Moodle app QR code or token link.');
  }
}

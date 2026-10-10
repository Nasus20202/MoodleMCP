import { classifyLink, decodeLaunchToken, LinkError, QRKind } from '@moodle-mcp/shared';

import { exchangeQR } from './api';
import type { Resolution } from './types/resolution';

/**
 * Turn whatever the user gave us (decoded QR text or a pasted link) into a token.
 * `exchange` is injectable for tests.
 */
export async function resolveToken(
  text: string,
  exchange: (qr: string) => Promise<string> = exchangeQR,
): Promise<Resolution> {
  switch (classifyLink(text)) {
    case QRKind.Token:
      return { status: 'token', token: decodeLaunchToken(text) };
    case QRKind.QRLogin:
      return { status: 'token', token: await exchange(text) };
    case QRKind.SiteOnly:
      return { status: 'needs-browser-login' };
    default:
      throw new LinkError('That is not a Moodle app QR code or token link.');
  }
}

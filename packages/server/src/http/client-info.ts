import type { MiddlewareHandler } from 'hono';

import { tokenFrom } from './auth.ts';
import type { AppEnv, ClientInfo } from './context.ts';

const FINGERPRINT_BYTES = 6;

/**
 * Cloudflare sets this header itself and overwrites any value a caller sends, so it can be trusted on
 * Workers. X-Forwarded-For is deliberately ignored: callers can forge it.
 */
export const CLIENT_IP_HEADER = 'CF-Connecting-IP';

/**
 * A short, stable identifier for a token, for correlating log lines. It is a truncated SHA-256: tokens are
 * long random strings, so this can neither be reversed nor used to guess the token. 48 bits is plenty to
 * tell users apart in logs.
 */
export async function tokenFingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest).slice(0, FINGERPRINT_BYTES), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

export async function clientInfoFrom(headers: Headers): Promise<ClientInfo> {
  const rawIp = headers.get(CLIENT_IP_HEADER)?.trim();
  const ip = rawIp === '' ? undefined : rawIp;
  const token = tokenFrom(headers);
  const tokenId = token ? await tokenFingerprint(token) : undefined;
  return { ...(ip && { ip }), ...(tokenId && { tokenId }) };
}

/** Makes `ip` and `tokenId` available to later middleware and routes as `c.get('client')`. */
export function clientInfo(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('client', await clientInfoFrom(c.req.raw.headers));
    await next();
  };
}

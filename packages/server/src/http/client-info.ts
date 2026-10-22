import type { MiddlewareHandler } from 'hono';

import { tokenFrom } from './auth.ts';
import type { AppEnv, ClientInfo } from './context.ts';

const FINGERPRINT_BYTES = 6;
const MAX_LABEL_LENGTH = 200;

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

/** Trims a caller-supplied label to something safe to log: no control characters, bounded length. */
function label(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value
    .replace(/\p{Cc}/gu, ' ')
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
  return clean === '' ? undefined : clean;
}

export async function clientInfoFrom(headers: Headers): Promise<ClientInfo> {
  const rawIp = headers.get(CLIENT_IP_HEADER)?.trim();
  const ip = rawIp === '' ? undefined : rawIp;
  const token = tokenFrom(headers);
  const tokenId = token ? await tokenFingerprint(token) : undefined;
  const userAgent = label(headers.get('User-Agent'));
  return { ...(ip && { ip }), ...(tokenId && { tokenId }), ...(userAgent && { userAgent }) };
}

/** The software name and version an MCP client announces in its `initialize` request. */
export interface McpClientInfo {
  clientName?: string;
  clientVersion?: string;
}

/**
 * Reads `params.clientInfo` from an MCP `initialize` request body (single or batched). Only that handshake
 * carries it and the server is stateless, so this is the one chance to see it. Undefined for any other body.
 * The values are caller-supplied: only these two labels are returned, bounded in length.
 */
export function mcpClientFrom(body: unknown): McpClientInfo | undefined {
  const messages: unknown[] = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) continue;
    const { method, params } = message as { method?: unknown; params?: unknown };
    if (method !== 'initialize') continue;
    const info = (params as { clientInfo?: { name?: unknown; version?: unknown } } | null | undefined)
      ?.clientInfo;
    const clientName = label(info?.name);
    const clientVersion = label(info?.version);
    return { ...(clientName && { clientName }), ...(clientVersion && { clientVersion }) };
  }
  return undefined;
}

/** Makes `ip`, `tokenId` and `userAgent` available to later middleware and routes as `c.get('client')`. */
export function clientInfo(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('client', await clientInfoFrom(c.req.raw.headers));
    await next();
  };
}

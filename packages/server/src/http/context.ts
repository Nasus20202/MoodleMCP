/** Who is calling, as far as logs are concerned. Every field is absent when unknown. */
export interface ClientInfo {
  /** Source IP address, as reported by Cloudflare. */
  ip?: string | undefined;
  /** Short fingerprint of the token (see `tokenFingerprint`), never the token itself. */
  tokenId?: string | undefined;
  /** The `User-Agent` header, sanitized and truncated (see `label`). Says which software called. */
  userAgent?: string | undefined;
}

/** Hono environment shared by all routes. */
export interface AppEnv {
  Variables: { client: ClientInfo };
}

/** Who is calling, as far as logs are concerned. Every field is absent when unknown. */
export interface ClientInfo {
  /** Source IP address, as reported by Cloudflare. */
  ip?: string;
  /** Short fingerprint of the token (see `tokenFingerprint`), never the token itself. */
  tokenId?: string;
  /** The `User-Agent` header, sanitized and truncated (see `userAgentFrom`). Says which software called. */
  userAgent?: string;
}

/** Hono environment shared by all routes. */
export interface AppEnv {
  Variables: { client: ClientInfo };
}

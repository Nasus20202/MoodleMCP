/** Who is calling, as far as logs are concerned. Both fields are absent when unknown. */
export interface ClientInfo {
  /** Source IP address, as reported by Cloudflare. */
  ip?: string;
  /** Short fingerprint of the token (see `tokenFingerprint`), never the token itself. */
  tokenId?: string;
}

/** Hono environment shared by all routes. */
export interface AppEnv {
  Variables: { client: ClientInfo };
}

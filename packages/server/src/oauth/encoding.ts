/** Base64url without padding, as used by PKCE and by our tokens. */
export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** Inverse of `toBase64Url`; undefined when the input is not valid base64url. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

const sha256 = async (text: string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/** The S256 PKCE challenge for a verifier (RFC 7636). */
export const pkceChallenge = async (verifier: string): Promise<string> => toBase64Url(await sha256(verifier));

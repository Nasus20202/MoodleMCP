/** `Uint8Array.prototype.toBase64` (ES2026), which TypeScript's lib does not declare yet. */
interface Base64Encodable {
  toBase64(): string;
}

/** Native in Workers and in Node 25+, so the unit tests run the same encoder as production. */
export const toBase64 = (bytes: Uint8Array): string => (bytes as Uint8Array & Base64Encodable).toBase64();

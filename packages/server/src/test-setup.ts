/**
 * Workers has `Uint8Array.prototype.toBase64` (ES2026); Node gains it only in version 25. The unit tests run
 * on Node 24, so they get this stand-in. The real one is exercised by the e2e tests, which run in workerd.
 */
const proto = Uint8Array.prototype as Uint8Array & { toBase64?: () => string };

proto.toBase64 ??= function (this: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < this.length; i += 0x8000) {
    binary += String.fromCharCode(...this.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

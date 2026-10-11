import { readBarcodes, setZXingModuleOverrides } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// Serve the decoder from our own assets instead of the CDN zxing-wasm falls back to.
setZXingModuleOverrides({
  locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
});

/** Decode the first QR code found in an image. Resolves to its text, or null if none was found. */
export async function decodeQR(image: Blob): Promise<string | null> {
  const results = await readBarcodes(image, {
    formats: ['QRCode'],
    tryHarder: true,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 1,
  });
  return results.find((r) => r.isValid)?.text ?? null;
}

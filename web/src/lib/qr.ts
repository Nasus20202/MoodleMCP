import jsQR from 'jsqr';

/** Longest image sides to try, in order. jsQR is sensitive to scale, and screenshots vary a lot. */
const TRY_SIZES = [1600, 1000, 600, 2400];

/** Decode the first QR code found in an image. Resolves to its text, or null if none was found. */
export async function decodeQR(image: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(image);
  try {
    for (const maxSide of TRY_SIZES) {
      const text = scan(bitmap, maxSide);
      if (text) return text;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

function scan(bitmap: ImageBitmap, maxSide: number): string | null {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

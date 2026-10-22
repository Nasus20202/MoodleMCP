/** Images a page carries inside its HTML as `data:image/...;base64,` URIs, which Moodle's editor produces on paste. */

/** Most images returned for one document. */
export const MAX_EMBEDDED_IMAGES = 10;
/** Largest single image, in bytes once decoded (the same limit as an image file). */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Most bytes of images returned for one document. */
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

/**
 * The value of an `src` attribute that is a base64 image of a type models accept. Group 1 is the type,
 * group 2 the data (which editors sometimes wrap over several lines).
 */
const IMAGE_SRC = /\ssrc\s*=\s*(["'])data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+?)\1/gi;

export interface EmbeddedImage {
  mimeType: string;
  base64: string;
}

export interface EmbeddedImages {
  images: EmbeddedImage[];
  /** Images found but left out for being too large or beyond the limits. */
  skipped: number;
}

/** The base64 images of an HTML document in document order, each once, within the size limits. */
export function embeddedImages(html: string): EmbeddedImages {
  const images: EmbeddedImage[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let total = 0;
  for (const match of html.matchAll(IMAGE_SRC)) {
    const base64 = (match[3] ?? '').replace(/\s+/g, '');
    if (seen.has(base64)) continue;
    seen.add(base64);
    const bytes = Math.floor((base64.length * 3) / 4);
    if (bytes > MAX_IMAGE_BYTES || total + bytes > MAX_TOTAL_BYTES || images.length >= MAX_EMBEDDED_IMAGES) {
      skipped++;
      continue;
    }
    total += bytes;
    images.push({ mimeType: (match[2] ?? '').toLowerCase(), base64 });
  }
  return { images, skipped };
}

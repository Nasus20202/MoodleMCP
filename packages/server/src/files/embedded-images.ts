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

/** Collects images one at a time within the limits, each once. */
class ImageCollector {
  readonly images: EmbeddedImage[] = [];
  skipped = 0;
  readonly #index = new Map<string, number | null>();
  #total = 0;

  /** The 1-based position of the image among those kept, or null when it was left out. */
  add(mimeType: string, rawBase64: string): number | null {
    const base64 = rawBase64.replace(/\s+/g, '');
    const known = this.#index.get(base64);
    if (known !== undefined) return known;
    const bytes = Math.floor((base64.length * 3) / 4);
    let position: number | null = null;
    if (
      bytes > MAX_IMAGE_BYTES ||
      this.#total + bytes > MAX_TOTAL_BYTES ||
      this.images.length >= MAX_EMBEDDED_IMAGES
    ) {
      this.skipped++;
    } else {
      this.#total += bytes;
      this.images.push({ mimeType: mimeType.toLowerCase(), base64 });
      position = this.images.length;
    }
    this.#index.set(base64, position);
    return position;
  }
}

/** The base64 images of an HTML document in document order, each once, within the size limits. */
export function embeddedImages(html: string): EmbeddedImages {
  const collector = new ImageCollector();
  for (const match of html.matchAll(IMAGE_SRC)) collector.add(match[2] ?? '', match[3] ?? '');
  return { images: collector.images, skipped: collector.skipped };
}

/**
 * Moves the base64 images out of every string of a JSON value (a tool result). Each `src` is replaced by
 * `data-image="N"`, N being the image's place in the returned list, or `"omitted"` when it was left out, so
 * the text still says where each picture sat. The limits apply to the value as a whole.
 */
export function extractEmbeddedImages(value: unknown): EmbeddedImages & { value: unknown } {
  const collector = new ImageCollector();
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return node.replace(IMAGE_SRC, (_all, _quote, mime: string, data: string) => {
        const position = collector.add(mime, data);
        return ` data-image="${position ?? 'omitted'}"`;
      });
    }
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node === 'object' && node !== null)
      return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]));
    return node;
  };
  const result = walk(value);
  return { value: result, images: collector.images, skipped: collector.skipped };
}

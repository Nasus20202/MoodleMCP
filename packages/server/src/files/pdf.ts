import type { extractImages, getDocumentProxy } from 'unpdf';

import { toBase64 } from './base64.ts';

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/** PDF.js `VerbosityLevel.ERRORS`: its font warnings ("TT: undefined function") are noise, the text still extracts. */
const PDFJS_ERRORS_ONLY = 0;

/**
 * Most pages read in one call. Extraction costs CPU per page whether or not the page has text, so this keeps
 * a call within the Worker's CPU budget even for long, image-heavy decks; the caller continues from `next`.
 */
export const MAX_PAGES_PER_CALL = 20;

/**
 * Most pages without a text layer read in one call. Their images are attached to the result, so a call stops
 * earlier: the cursor must never move past a scan whose picture was left out for lack of room. A page with text
 * is not counted, however many of them a call reads.
 */
export const MAX_IMAGE_PAGES_PER_CALL = 10;

/** Pages with less text than this are pictures more than prose (scans, covers), so a call reads fewer of them. */
const IMAGE_PAGE_TEXT_LIMIT = 64;

/** Limits on the extracted images, the same as those on pictures embedded in HTML. */
const MAX_IMAGES_PER_CALL = 10;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024;

const PAGE_SEPARATOR = '\n\n';

/** Where to start reading: a page, and a character offset into the text from that page on. */
export interface PdfCursor {
  page: number;
  offset: number;
}

export interface PdfWindow extends PdfCursor {
  maxChars: number;
  /** Also extract the pictures painted on the pages read. */
  images?: boolean | undefined;
}

/** A picture painted on a page, as a PNG block the model can see. */
export interface PdfImage {
  base64: string;
  width: number;
  height: number;
  /** Page the image was painted on. */
  page: number;
}

export interface PdfChunk {
  /** At most `maxChars` characters, each page headed `--- Page N ---`. */
  text: string;
  /** Pages in the document. */
  pages: number;
  /** First and last page the text comes from; undefined when there is none. */
  firstPage?: number | undefined;
  lastPage?: number | undefined;
  /** Where the next call continues; null at the end of the document. */
  next: PdfCursor | null;
  /** Pictures painted on the pages in the text (scans, figures, photographs), in page order. */
  images: PdfImage[];
  /** Pictures on those pages left out for being too large or beyond the count and size limits. */
  skippedImages: number;
  /** More pictures are on those pages than one call returns (the limit was reached). */
  moreImages: boolean;
}

/** One page's text: PDF.js items joined, runs of blanks collapsed, at most one blank line kept. */
async function pageText(pdf: PdfDocument, page: number): Promise<string> {
  const content = await (await pdf.getPage(page)).getTextContent();
  return content.items
    .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
    .join('')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * All the pictures painted on the pages of a text window: scans, figures, photographs, and the small ones
 * (icons, logos) too, since the caller asked for them. Repeated pictures are kept once. Best effort: a page whose
 * images PDF.js cannot decode still contributes its text.
 */
async function windowImages(
  pdf: PdfDocument,
  extract: typeof extractImages,
  { first, last }: { first: number; last: number },
): Promise<{ images: PdfImage[]; skipped: number; more: boolean }> {
  const images: PdfImage[] = [];
  /** Base64 of the pictures already kept, so a logo repeated on every page is attached once. */
  const seen = new Set<string>();
  let skipped = 0;
  let more = false;
  let totalBytes = 0;
  for (let page = first; page <= last; page++) {
    if (images.length >= MAX_IMAGES_PER_CALL || totalBytes >= MAX_TOTAL_IMAGE_BYTES) {
      more = true;
      break;
    }
    let found;
    try {
      found = await extract(pdf, page, { format: 'png' });
    } catch {
      // An image PDF.js cannot decode is not worth failing the text for.
      continue;
    }
    for (const image of found) {
      if (
        image.data.byteLength > MAX_IMAGE_BYTES ||
        totalBytes + image.data.byteLength > MAX_TOTAL_IMAGE_BYTES ||
        images.length >= MAX_IMAGES_PER_CALL
      ) {
        skipped++;
        continue;
      }
      const base64 = toBase64(image.data);
      if (seen.has(base64)) continue;
      seen.add(base64);
      totalBytes += image.data.byteLength;
      images.push({ base64, width: image.width, height: image.height, page });
    }
  }
  return { images, skipped, more };
}

/**
 * Reads a PDF from `page` on, extracting only as many pages as it takes to fill `maxChars` after skipping
 * `offset` characters (and never more than `MAX_PAGES_PER_CALL`). Pages are what costs CPU, so a call that
 * continues from `next` never re-extracts the pages before it. The pictures painted on the pages it returns are
 * returned too, so a scanned document can still be read and a slide's figures are not lost.
 */
export async function readPdf(
  bytes: Uint8Array,
  { page, offset, maxChars, images = false }: PdfWindow,
): Promise<PdfChunk> {
  const unpdf = await import('unpdf');
  // PDF.js may take ownership of the buffer it is given, so hand it a copy.
  const pdf = await unpdf.getDocumentProxy(new Uint8Array(bytes), { verbosity: PDFJS_ERRORS_ONLY });
  try {
    const pages = pdf.numPages;
    const blocks: string[] = [];
    /** Where each block starts in the joined text. */
    const starts: number[] = [];
    let length = 0;
    let next = page;
    let imagePages = 0;
    while (next <= pages && next < page + MAX_PAGES_PER_CALL && length < offset + maxChars) {
      const start = blocks.length === 0 ? 0 : length + PAGE_SEPARATOR.length;
      const body = await pageText(pdf, next);
      const block = body ? `--- Page ${next} ---\n${body}` : `--- Page ${next} ---`;
      starts.push(start);
      blocks.push(block);
      length = start + block.length;
      next++;
      // A page with (almost) no text brings its picture along, so read fewer of them per call.
      if (body.length < IMAGE_PAGE_TEXT_LIMIT && ++imagePages >= MAX_IMAGE_PAGES_PER_CALL) break;
    }

    const text = blocks.join(PAGE_SEPARATOR);
    const slice = text.slice(offset, offset + maxChars);
    const end = offset + slice.length;
    /** Index of the block holding character `at` of the joined text. */
    const blockAt = (at: number) => starts.findLastIndex((start) => start <= at);

    let cursor: PdfCursor | null = null;
    if (end < text.length) {
      const i = blockAt(end);
      const within = end - (starts[i] ?? 0);
      // Stopping inside the separator after a page means the next call starts cleanly on the following page.
      cursor =
        within >= (blocks[i]?.length ?? 0)
          ? { page: page + i + 1, offset: 0 }
          : { page: page + i, offset: within };
    } else if (next <= pages) {
      // The text read ran out first, because of the page cap or an offset past it: carry on with the next page.
      cursor = { page: next, offset: Math.max(0, offset - text.length - PAGE_SEPARATOR.length) };
    }

    const firstPage = slice.length > 0 ? page + blockAt(offset) : undefined;
    const lastPage = slice.length > 0 ? page + blockAt(end - 1) : undefined;
    const pictures =
      !images || firstPage === undefined || lastPage === undefined
        ? { images: [], skipped: 0, more: false }
        : await windowImages(pdf, unpdf.extractImages, { first: firstPage, last: lastPage });

    return {
      text: slice,
      pages,
      firstPage,
      lastPage,
      next: cursor,
      images: pictures.images,
      skippedImages: pictures.skipped,
      moreImages: pictures.more,
    };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

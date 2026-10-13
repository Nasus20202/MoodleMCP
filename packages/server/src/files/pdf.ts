import type { getDocumentProxy } from 'unpdf';

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/** PDF.js `VerbosityLevel.ERRORS`: its font warnings ("TT: undefined function") are noise, the text still extracts. */
const PDFJS_ERRORS_ONLY = 0;

/**
 * Most pages read in one call. Extraction costs CPU per page whether or not the page has text, so this keeps
 * a call within the Worker's CPU budget even for long, image-heavy decks; the caller continues from `next`.
 */
export const MAX_PAGES_PER_CALL = 20;

const PAGE_SEPARATOR = '\n\n';

/** Where to start reading: a page, and a character offset into the text from that page on. */
export interface PdfCursor {
  page: number;
  offset: number;
}

export interface PdfWindow extends PdfCursor {
  maxChars: number;
}

export interface PdfChunk {
  /** At most `maxChars` characters, each page headed `--- Page N ---`. */
  text: string;
  /** Pages in the document. */
  pages: number;
  /** First and last page the text comes from; undefined when there is none. */
  firstPage?: number;
  lastPage?: number;
  /** Where the next call continues; null at the end of the document. */
  next: PdfCursor | null;
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
 * Reads a PDF from `page` on, extracting only as many pages as it takes to fill `maxChars` after skipping
 * `offset` characters (and never more than `MAX_PAGES_PER_CALL`). Pages are what costs CPU, so a call that
 * continues from `next` never re-extracts the pages before it.
 */
export async function readPdf(bytes: Uint8Array, { page, offset, maxChars }: PdfWindow): Promise<PdfChunk> {
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
    while (next <= pages && next < page + MAX_PAGES_PER_CALL && length < offset + maxChars) {
      const start = blocks.length === 0 ? 0 : length + PAGE_SEPARATOR.length;
      const body = await pageText(pdf, next);
      const block = body ? `--- Page ${next} ---\n${body}` : `--- Page ${next} ---`;
      starts.push(start);
      blocks.push(block);
      length = start + block.length;
      next++;
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

    return {
      text: slice,
      pages,
      ...(slice.length > 0 && {
        firstPage: page + blockAt(offset),
        lastPage: page + blockAt(end - 1),
      }),
      next: cursor,
    };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

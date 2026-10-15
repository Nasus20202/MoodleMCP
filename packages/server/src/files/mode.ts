import { DESCRIBED_KINDS, MARKDOWN_KINDS } from './markdown.ts';
import type { Kind } from './read.ts';

/** How read_file turns a file into something the model can read. */
export const ReadMode = {
  /** Markdown where it is lossless and supported, extraction otherwise. */
  Auto: 'auto',
  /** Workers AI's `toMarkdown`: no Worker CPU, keeps headings and tables; images get a description. */
  Markdown: 'markdown',
  /** Our own parsers: PDFs page by page, images returned as images. */
  Extract: 'extract',
  /** The unmodified file as an MCP content block: image, audio or embedded resource by type. */
  Resource: 'resource',
} as const;
export type ReadMode = (typeof ReadMode)[keyof typeof ReadMode];

export interface ModeChoice {
  mode: typeof ReadMode.Markdown | typeof ReadMode.Extract;
  /** Why the requested mode was not used, for the model. */
  note?: string;
}

export interface ModeContext {
  /** Whether a converter (the AI binding) is configured. */
  canConvert: boolean;
  /** The requested PDF page; jumping to a page needs extraction. */
  page: number;
}

/** Picks between markdown and extraction for a file that is not returned as a resource. */
export function chooseMode(
  requested: Exclude<ReadMode, typeof ReadMode.Resource>,
  kind: Kind,
  { canConvert, page }: ModeContext,
): ModeChoice {
  const extract = (note?: string): ModeChoice => ({ mode: ReadMode.Extract, ...(note && { note }) });
  switch (requested) {
    case ReadMode.Extract:
      return extract();
    case ReadMode.Markdown:
      if (!canConvert)
        return extract('Markdown conversion is not set up on this server; the text was extracted.');
      if (!MARKDOWN_KINDS.has(kind) && !DESCRIBED_KINDS.has(kind)) {
        return extract('Markdown conversion does not support this file type; the text was extracted.');
      }
      return { mode: ReadMode.Markdown };
    case ReadMode.Auto:
      return canConvert && MARKDOWN_KINDS.has(kind) && !(kind === 'pdf' && page > 1)
        ? { mode: ReadMode.Markdown }
        : extract();
  }
}

import type { DownloadedFile } from '../moodle/client.ts';
import type { Kind } from './read.ts';

/**
 * Workers AI's document converter (`env.AI.toMarkdown`). Conversion runs on Cloudflare's side, so it costs
 * the Worker almost no CPU, unlike PDF.js; the Worker only waits for the result.
 */
export interface MarkdownConverter {
  toMarkdown(file: MarkdownDocument, options?: ConversionRequestOptions): Promise<ConversionResponse>;
}

/** Formats `toMarkdown` turns into the document's text. PPTX is not supported by it. */
export const MARKDOWN_KINDS: ReadonlySet<Kind> = new Set(['pdf', 'docx', 'xlsx', 'html']);

/**
 * Images are described by a model rather than transcribed, which is a summary, and spends the account's daily
 * Workers AI allowance. So they are converted only when asked for, and images inside documents never are.
 */
export const DESCRIBED_KINDS: ReadonlySet<Kind> = new Set(['image']);

const NO_IMAGES = { convert: false };

const OPTIONS: ConversionRequestOptions = {
  conversionOptions: {
    pdf: { metadata: false, images: NO_IMAGES },
    docx: { images: NO_IMAGES },
    html: { images: { ...NO_IMAGES, convertOGImage: false } },
  },
};

/**
 * How long to wait for a conversion before extracting the text ourselves. MCP clients give up on a tool call
 * after about a minute, and a stalled conversion should not take the whole call with it.
 */
export const CONVERSION_TIMEOUT_MS = 20_000;

/** `toMarkdown` reported that it could not convert the file. */
export class MarkdownConversionError extends Error {
  override name = 'MarkdownConversionError';
}

/** `toMarkdown` did not answer within the timeout. */
export class MarkdownTimeoutError extends Error {
  override name = 'MarkdownTimeoutError';
  constructor() {
    super('Markdown conversion timed out');
  }
}

export interface Markdown {
  text: string;
  /** Tokens Workers AI counted for the conversion, for watching the daily allowance. */
  tokens: number;
}

/** The file's Markdown. `mimeType` is the effective type, since Moodle often sends octet-stream. */
export async function toMarkdown(
  converter: MarkdownConverter,
  file: Pick<DownloadedFile, 'bytes' | 'filename'>,
  mimeType: string,
  timeoutMs = CONVERSION_TIMEOUT_MS,
): Promise<Markdown> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MarkdownTimeoutError()), timeoutMs);
  });
  try {
    const result = await Promise.race([
      converter.toMarkdown(
        { name: file.filename, blob: new Blob([file.bytes], { type: mimeType }) },
        OPTIONS,
      ),
      timeout,
    ]);
    if (result.format === 'error') throw new MarkdownConversionError(result.error);
    return { text: result.data.trim(), tokens: result.tokens };
  } finally {
    clearTimeout(timer);
  }
}

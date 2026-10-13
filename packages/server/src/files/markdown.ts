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
 * How long to wait for a conversion before extracting the text ourselves. Converting a large file or describing
 * an image can be slow, so this is generous; but MCP clients give up on a tool call after about a minute, and the
 * fallback needs time left to run, so a stalled conversion must not take the whole call with it.
 */
export const CONVERSION_TIMEOUT_MS = 40_000;

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

/**
 * Why a conversion failed, as a fixed code. Workers AI's own message can name the file, so it is classified here
 * and never logged or returned: only the code is.
 */
export const ConversionFailure = {
  /** No answer within the timeout. */
  Timeout: 'timeout',
  /** The Workers AI allowance or a rate limit is used up. */
  Quota: 'quota',
  /** The converter does not handle this file. */
  Unsupported: 'unsupported',
  /** Anything else: an outage, a corrupt file, an error we do not recognise. */
  Failed: 'failed',
} as const;
export type ConversionFailure = (typeof ConversionFailure)[keyof typeof ConversionFailure];

const QUOTA_MESSAGE = /neurons?|allocation|allowance|quota|rate.?limit|too many requests|\b429\b/i;
const UNSUPPORTED_MESSAGE = /unsupported|not supported|unrecognized|unknown (?:file|format|type)/i;

/** Sorts a failed conversion into a {@link ConversionFailure}. Never throws, whatever was thrown. */
export function classifyConversionFailure(error: unknown): ConversionFailure {
  if (error instanceof MarkdownTimeoutError) return ConversionFailure.Timeout;
  const message = error instanceof Error ? error.message : '';
  if (QUOTA_MESSAGE.test(message)) return ConversionFailure.Quota;
  if (UNSUPPORTED_MESSAGE.test(message)) return ConversionFailure.Unsupported;
  return ConversionFailure.Failed;
}

const FAILURE_NOTES: Record<ConversionFailure, string> = {
  timeout: 'Markdown conversion failed: it timed out. The text was extracted instead.',
  quota:
    'Markdown conversion failed: the Workers AI allowance may be used up, so it may work again later. ' +
    'The text was extracted instead.',
  unsupported:
    'Markdown conversion failed: the converter cannot handle this file. The text was extracted instead.',
  failed: 'Markdown conversion failed; the text was extracted instead.',
};

/** The note for the caller when a conversion failed and the text was extracted instead. */
export const conversionFailureNote = (reason: ConversionFailure): string => FAILURE_NOTES[reason];

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
    const conversion = converter.toMarkdown(
      { name: file.filename, blob: new Blob([file.bytes], { type: mimeType }) },
      OPTIONS,
    );
    // When the timeout wins the race, nobody awaits the conversion any more: a later failure would surface as an
    // unhandled rejection, so it is swallowed here (the timeout is what gets reported).
    conversion.catch(() => undefined);
    const result = await Promise.race([conversion, timeout]);
    if (result.format === 'error') throw new MarkdownConversionError(result.error);
    return { text: result.data.trim(), tokens: result.tokens };
  } finally {
    clearTimeout(timer);
  }
}

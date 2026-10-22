import { ReadMode } from '../files/mode.ts';
import type { PdfChunk } from '../files/pdf.ts';
import { pageText } from '../files/read.ts';
import type { LogFields, Logger } from '../logger.ts';
import type { DownloadedFile } from '../moodle/client.ts';
import { jsonContent, type ToolContent } from './define.ts';

/** Characters returned when `max_chars` is not given, and the most one call may return. */
export const DEFAULT_CHARS = 50_000;
export const MAX_CHARS = 1_000_000;

/** What every result says about the file it came from. */
export const describeFile = (file: DownloadedFile) => ({
  filename: file.filename,
  mime_type: file.mimeType,
  size_bytes: file.bytes.byteLength,
});

/** The notes that are set, joined; undefined when none is, so the field is left out of the JSON. */
export const joinNotes = (...notes: (string | undefined)[]) => notes.filter(Boolean).join(' ') || undefined;

/** Logs a file that is not read, and why. */
export const logUnreadable = (logger: Logger, mime: string, reason: string) =>
  logger.info('file not readable', { mime, reason });

/** Logs a file our own parsers read: sizes and timing only, never its name or text. */
export function logParsed(
  logger: Logger,
  file: DownloadedFile,
  format: string,
  started: number,
  fields: LogFields = {},
) {
  logger.info('file parsed', {
    format,
    mode: ReadMode.Extract,
    mime: file.mimeType,
    bytes: file.bytes.byteLength,
    ...fields,
    ms: Date.now() - started,
  });
}

/** Logs a file our parsers could not read, by the error's class; `started` adds the time spent. */
export function logParseFailed(
  logger: Logger,
  file: DownloadedFile,
  format: string,
  error: unknown,
  started?: number,
) {
  logger.warn('file parse failed', {
    format,
    mime: file.mimeType,
    bytes: file.bytes.byteLength,
    ms: started === undefined ? undefined : Date.now() - started,
    error: errorName(error),
  });
}

/** The class of an error, for the logs. Its message is left out: it can name the file. */
export const errorName = (error: unknown) => (error instanceof Error ? error.name : 'unknown');

export interface TextReading {
  format: string;
  mode: ReadMode;
  text: string;
  pages?: number | undefined;
  note?: string | undefined;
}

/** A whole-document text, paged by characters. */
export function textResult(
  file: DownloadedFile,
  { offset, max_chars }: { offset: number; max_chars: number },
  reading: TextReading,
): ToolContent[] {
  const { slice, totalChars, nextOffset } = pageText(reading.text, { offset, maxChars: max_chars });
  const empty =
    totalChars === 0
      ? 'No text found. A scanned or image-only document has no text layer.'
      : offset >= totalChars
        ? 'offset is past the end of the file.'
        : undefined;
  return jsonContent({
    ...describeFile(file),
    readable: true,
    format: reading.format,
    mode: reading.mode,
    pages: reading.pages,
    total_chars: totalChars,
    offset,
    next_offset: nextOffset,
    note: joinNotes(reading.note, empty),
    text: slice,
  });
}

/** The pages of a PDF read in extract mode, paged by page and then by characters. */
export function pdfResult(
  file: DownloadedFile,
  { offset, page }: { offset: number; page: number },
  chunk: PdfChunk,
  note: string | undefined,
): ToolContent[] {
  const noText = chunk.text.replace(/--- Page \d+ ---/g, '').trim() === '';
  return jsonContent({
    ...describeFile(file),
    readable: true,
    format: 'pdf',
    mode: ReadMode.Extract,
    pages: chunk.pages,
    page,
    offset,
    first_page: chunk.firstPage,
    last_page: chunk.lastPage,
    next_page: chunk.next?.page ?? null,
    next_offset: chunk.next?.offset ?? null,
    note: joinNotes(
      note,
      page > chunk.pages
        ? `page is past the end of the document, which has ${chunk.pages} pages.`
        : noText
          ? 'No text found on these pages. A scanned or image-only document has no text layer.'
          : undefined,
    ),
    text: chunk.text,
  });
}

/** An image returned as an image block, with the usual description after it. */
export function imageResult(
  file: DownloadedFile,
  image: { base64: string; mimeType: string },
  note: string | undefined,
): ToolContent[] {
  return [
    { type: 'image', data: image.base64, mimeType: image.mimeType },
    ...jsonContent({
      ...describeFile(file),
      readable: true,
      mode: ReadMode.Extract,
      note: joinNotes(note, 'The image is attached.'),
    }),
  ];
}

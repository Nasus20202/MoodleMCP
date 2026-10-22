import type { ReadMode } from '../files/mode.ts';
import { pageText } from '../files/read.ts';
import type { Logger } from '../logger.ts';
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

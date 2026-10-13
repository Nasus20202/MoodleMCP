import * as z from 'zod/v4';

import { MAX_PAGES_PER_CALL } from '../files/pdf.ts';
import { classify, pageText, readFile, toBase64, unsupportedReason } from '../files/read.ts';
import type { DownloadedFile } from '../moodle/client.ts';
import { defineCustomTool, jsonContent, type ToolContent } from './define.ts';
import { ToolName } from './names.ts';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_CHARS = 30_000;
const MAX_CHARS = 100_000;

const describeFile = (file: DownloadedFile) => ({
  filename: file.filename,
  mime_type: file.mimeType,
  size_bytes: file.bytes.byteLength,
});

export const readFileTool = defineCustomTool({
  name: ToolName.ReadFile,
  description:
    'Read the contents of a file from a course: PDF slides and notes, Word, PowerPoint and Excel documents, ' +
    'HTML, plain text/code/CSV, and images. Pass a `fileurl` exactly as it appears in the output of ' +
    'get_course_contents, list_resources, list_pages, list_labels, list_wikis or get_forum_posts ' +
    '(it looks like https://<site>/webservice/pluginfile.php/...). Returns JSON with the extracted `text` ' +
    'and paging info; if `next_offset` is not null the file is longer, so call again with `offset` set to ' +
    `that value. PDFs are read a few pages at a time (at most ${MAX_PAGES_PER_CALL} per call), each page headed ` +
    '"--- Page N ---": while `next_page` is not null, call again with `page` and `offset` set to `next_page` ' +
    'and `next_offset`; to jump to a page, pass `page` alone. Images are returned as images. Scanned PDFs ' +
    'have no text layer and come back empty. ' +
    'XLSX comes back as tab-separated sheets. Other types (archives, audio, video) cannot be read as ' +
    'text: set `raw` to true to get the unmodified file as base64 (any type), otherwise tell the ' +
    'user and give them the link. Files up to 20 MB.',
  input: z.object({
    file_url: z.string().min(1).describe('`fileurl` of a file, copied unchanged from another tool'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'character to start from; use `next_offset` from the previous call (for PDFs, counted from `page`)',
      ),
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe('PDF only: page to start from; use `next_page` from the previous call'),
    raw: z
      .boolean()
      .default(false)
      .describe(
        'return the unmodified file (base64) of any type instead of extracted text; offset and max_chars are ignored; limit 20 MB',
      ),
    max_chars: z
      .number()
      .int()
      .min(1000)
      .max(MAX_CHARS)
      .default(DEFAULT_CHARS)
      .describe(`most characters to return (default ${DEFAULT_CHARS}, max ${MAX_CHARS})`),
  }),
  async run({ client, logger }, { file_url, offset, page, max_chars, raw }) {
    if (raw) {
      const file = await client.download(file_url, MAX_FILE_BYTES);
      logger.info('file returned raw', { mime: file.mimeType, bytes: file.bytes.byteLength });
      return [
        {
          type: 'resource',
          resource: {
            uri: `moodle-file:///${encodeURIComponent(file.filename)}`,
            mimeType: file.mimeType || 'application/octet-stream',
            blob: toBase64(file.bytes),
          },
        },
        ...jsonContent({ ...describeFile(file), note: 'The unmodified file is attached as base64.' }),
      ];
    }

    const file = await client.download(file_url, MAX_FILE_BYTES, (meta) => classify(meta) !== null);
    if (file.skipped) {
      logger.info('file not readable', { mime: file.mimeType, reason: 'unsupported type' });
      return jsonContent({
        filename: file.filename,
        mime_type: file.mimeType,
        readable: false,
        note: unsupportedReason(file),
      });
    }

    const meta = describeFile(file);
    const format = classify(file);
    const started = Date.now();
    let reading;
    try {
      reading = await readFile(file, { page, offset, maxChars: max_chars });
    } catch (error) {
      // Corrupt, encrypted or oversized-when-inflated files: report to the model, don't crash the call.
      logger.warn('file parse failed', {
        format,
        mime: file.mimeType,
        bytes: meta.size_bytes,
        ms: Date.now() - started,
        error: error instanceof Error ? error.name : 'unknown',
        detail: error instanceof Error ? error.message.slice(0, 200) : undefined,
      });
      return jsonContent({
        ...meta,
        readable: false,
        note: 'The file could not be parsed: it may be corrupt, password-protected or in an unusual format.',
      });
    }

    if (reading.kind === 'unsupported') {
      logger.info('file not readable', { mime: file.mimeType, reason: 'too large to return' });
      return jsonContent({ ...meta, readable: false, note: reading.reason });
    }
    if (reading.kind === 'image') {
      logger.info('file parsed', {
        format,
        mime: file.mimeType,
        bytes: meta.size_bytes,
        ms: Date.now() - started,
      });
      const image: ToolContent = { type: 'image', data: reading.base64, mimeType: reading.mimeType };
      return [image, ...jsonContent({ ...meta, readable: true, note: 'The image is attached.' })];
    }

    if (reading.kind === 'pdf') {
      const { chunk } = reading;
      const pagesRead =
        chunk.firstPage === undefined ? 0 : (chunk.lastPage ?? chunk.firstPage) - chunk.firstPage + 1;
      logger.info('file parsed', {
        format,
        mime: file.mimeType,
        bytes: meta.size_bytes,
        pages: chunk.pages,
        pagesRead,
        chars: chunk.text.length,
        truncated: chunk.next !== null,
        ms: Date.now() - started,
      });
      const noText = chunk.text.replace(/--- Page \d+ ---/g, '').trim() === '';
      return jsonContent({
        ...meta,
        readable: true,
        format: 'pdf',
        pages: chunk.pages,
        page,
        offset,
        ...(chunk.firstPage !== undefined && { first_page: chunk.firstPage, last_page: chunk.lastPage }),
        next_page: chunk.next?.page ?? null,
        next_offset: chunk.next?.offset ?? null,
        ...(page > chunk.pages
          ? { note: `page is past the end of the document, which has ${chunk.pages} pages.` }
          : noText
            ? { note: 'No text found on these pages. A scanned or image-only document has no text layer.' }
            : {}),
        text: chunk.text,
      });
    }

    const { slice, totalChars, nextOffset } = pageText(reading.text, { offset, maxChars: max_chars });
    logger.info('file parsed', {
      format,
      mime: file.mimeType,
      bytes: meta.size_bytes,
      pages: reading.pages,
      chars: totalChars,
      truncated: nextOffset !== null,
      ms: Date.now() - started,
    });
    return jsonContent({
      ...meta,
      readable: true,
      format: reading.format,
      ...(reading.pages === undefined ? {} : { pages: reading.pages }),
      total_chars: totalChars,
      offset,
      next_offset: nextOffset,
      ...(totalChars === 0
        ? { note: 'No text found. A scanned or image-only document has no text layer.' }
        : offset >= totalChars
          ? { note: 'offset is past the end of the file.' }
          : {}),
      text: slice,
    });
  },
});

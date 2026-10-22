import * as z from 'zod/v4';

import { classifyConversionFailure, conversionFailureNote, toMarkdown } from '../files/markdown.ts';
import { chooseMode, type ModeChoice, ReadMode } from '../files/mode.ts';
import { MAX_PAGES_PER_CALL } from '../files/pdf.ts';
import { classify, effectiveType, readFile, toBase64, unsupportedReason } from '../files/read.ts';
import { encodingNote, judge, readableByContent, withSniffedType } from '../files/sniff.ts';
import type { DownloadedFile } from '../moodle/client.ts';
import { defineCustomTool, jsonContent, type ToolContent, type ToolContext } from './define.ts';
import { ToolName } from './names.ts';
import { listArchive, openEntry } from './read-file-archive.ts';
import {
  DEFAULT_CHARS,
  describeFile,
  errorName,
  joinNotes,
  logUnreadable,
  MAX_CHARS,
  textResult,
} from './read-file-results.ts';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const input = z.object({
  file_url: z.string().min(1).describe('`fileurl` of a file, copied unchanged from another tool'),
  mode: z
    .enum([ReadMode.Auto, ReadMode.Markdown, ReadMode.Extract, ReadMode.Resource])
    .default(ReadMode.Auto)
    .describe(
      'auto (default): Markdown for PDF, Word, Excel and HTML when available, otherwise extracted text; ' +
        'markdown: convert to Markdown (keeps headings and tables; for an image, a written description); ' +
        'extract: our own text extraction, PDFs page by page and images as images; ' +
        'resource: the unmodified file, any type, ignoring offset and max_chars: an image block for images, ' +
        'an audio block for audio, an embedded resource for the rest (not every client accepts those)',
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      'character to start from; use `next_offset` from the previous call (for PDFs, counted from `page`)',
    ),
  entry: z
    .string()
    .min(1)
    .max(1024)
    .optional()
    .describe(
      'ZIP only: path of one file inside the archive, copied unchanged from the `entries` of a previous call ' +
        'without `entry`; that file is then read like any other, so `offset`, `page` and `max_chars` apply to it',
    ),
  page: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe('PDF only, extract mode: page to start from; use `next_page` from the previous call'),
  max_chars: z
    .number()
    .int()
    .min(1000)
    .max(MAX_CHARS)
    .default(DEFAULT_CHARS)
    .describe(
      `most characters to return (default ${DEFAULT_CHARS}, max ${MAX_CHARS}); raise it to read a whole ` +
        'document in one call, e.g. to summarise it',
    ),
});

type Input = z.output<typeof input>;

export const readFileTool = defineCustomTool({
  name: ToolName.ReadFile,
  description:
    'Read the contents of a file from a course: PDF slides and notes, Word, PowerPoint and Excel documents, ' +
    'HTML, plain text/code/CSV, and images. Pass a `fileurl` exactly as it appears in the output of ' +
    'get_course_contents, list_resources, list_pages, list_labels, list_wikis or get_forum_posts ' +
    '(it looks like https://<site>/webservice/pluginfile.php/...). Returns JSON with the `text`, the `mode` ' +
    'used, and paging info; if `next_offset` is not null the file is longer, so call again with `offset` ' +
    'set to that value (and `page` to `next_page` when there is one). In extract mode PDFs are read a few ' +
    `pages at a time (at most ${MAX_PAGES_PER_CALL} per call), each page headed "--- Page N ---"; to jump to ` +
    'a page, pass `page`. Images are returned as images unless `mode` is markdown. Scanned PDFs have no ' +
    'text layer and come back empty. A ZIP archive comes back as a list of its `entries`; call again with ' +
    '`entry` set to one of their paths to read that file. Other types (audio, video) cannot be read as ' +
    'text: use mode resource to get the file, otherwise tell the user and give them the link. Files up to ' +
    '20 MB.',
  input,
  async run(context, args) {
    return args.mode === ReadMode.Resource ? readResource(context, args) : readText(context, args);
  },
});

async function readResource({ client, logger }: ToolContext, { file_url }: Input): Promise<ToolContent[]> {
  const file = withSniffedType(await client.download(file_url, MAX_FILE_BYTES));
  logger.info('file returned as resource', { mime: file.mimeType, bytes: file.bytes.byteLength });
  const data = toBase64(file.bytes);
  const mimeType = file.mimeType || 'application/octet-stream';
  const note = jsonContent({ ...describeFile(file), note: 'The unmodified file is attached.' });
  if (mimeType.startsWith('image/')) return [{ type: 'image', data, mimeType }, ...note];
  if (mimeType.startsWith('audio/')) return [{ type: 'audio', data, mimeType }, ...note];
  return [
    {
      type: 'resource',
      resource: { uri: `moodle-file:///${encodeURIComponent(file.filename)}`, mimeType, blob: data },
    },
    ...note,
  ];
}

async function readText(context: ToolContext, args: Input): Promise<ToolContent[]> {
  // A file of unknown type is looked into: its first bytes say whether it is worth reading.
  const file = await context.client.download(args.file_url, MAX_FILE_BYTES, judge, readableByContent);
  return readDocument(context, withSniffedType(file), args, {});
}

/** Where a file being read came from, when it is an entry of an archive. */
interface Origin {
  /** Said before any other note, so the model knows what it is looking at. */
  note?: string | undefined;
  /** Archives inside archives are not opened. */
  nested?: boolean;
}

async function readDocument(
  context: ToolContext,
  file: DownloadedFile,
  args: Input,
  origin: Origin,
): Promise<ToolContent[]> {
  const { logger, markdown } = context;
  const format = classify(file);
  if (file.skipped || format === null) {
    logUnreadable(logger, file.mimeType, 'unsupported type');
    return jsonContent({
      filename: file.filename,
      mime_type: effectiveType(file) || 'application/octet-stream',
      // A file refused from its headers was never downloaded, so its size is not known.
      size_bytes: file.skipped ? undefined : file.bytes.byteLength,
      readable: false,
      note: joinNotes(origin.note, unsupportedReason(file)),
    });
  }
  if (format === 'zip') {
    if (origin.nested) {
      logUnreadable(logger, file.mimeType, 'nested archive');
      return jsonContent({
        ...describeFile(file),
        readable: false,
        note: joinNotes(origin.note, 'An archive inside an archive is not opened.'),
      });
    }
    return args.entry === undefined
      ? listArchive(logger, file, args)
      : readEntry(context, file, args, args.entry);
  }

  if (args.entry !== undefined && !origin.nested) {
    origin = {
      ...origin,
      note: joinNotes(origin.note, '`entry` is only used for ZIP archives and was ignored.'),
    };
  }
  const requested = args.mode === ReadMode.Resource ? ReadMode.Auto : args.mode;
  let choice: ModeChoice = chooseMode(requested, format, {
    canConvert: markdown !== undefined,
    page: args.page,
  });
  if (choice.mode === ReadMode.Markdown && markdown) {
    const started = Date.now();
    try {
      const { text, tokens } = await toMarkdown(markdown, file, effectiveType(file));
      logger.info('file converted', {
        format,
        mode: choice.mode,
        mime: file.mimeType,
        bytes: file.bytes.byteLength,
        chars: text.length,
        tokens,
        ms: Date.now() - started,
      });
      return textResult(file, args, { format, mode: ReadMode.Markdown, text, note: origin.note });
    } catch (error) {
      // Quota spent, an outage, a timeout or a file it cannot handle: our own parsers still have a go.
      // Only a fixed reason code is logged and returned: Workers AI's message can name the file.
      const reason = classifyConversionFailure(error);
      logger.warn('markdown conversion failed', {
        format,
        mime: file.mimeType,
        bytes: file.bytes.byteLength,
        ms: Date.now() - started,
        reason,
        error: errorName(error),
      });
      choice = { mode: ReadMode.Extract, note: conversionFailureNote(reason) };
    }
  }
  return extract(context, file, format, args, joinNotes(origin.note, choice.note));
}

/** One file out of an archive, read as if it had been downloaded on its own. */
async function readEntry(
  context: ToolContext,
  archive: DownloadedFile,
  args: Input,
  path: string,
): Promise<ToolContent[]> {
  const opening = openEntry(archive, path, context.logger);
  if (!opening.ok) return jsonContent({ ...describeFile(archive), readable: false, note: opening.note });
  return readDocument(context, withSniffedType(opening.file), args, {
    nested: true,
    note: `Read from ${archive.filename}: ${path}.`,
  });
}

async function extract(
  { logger }: ToolContext,
  file: DownloadedFile,
  format: NonNullable<ReturnType<typeof classify>>,
  args: Input,
  modeNote: string | undefined,
): Promise<ToolContent[]> {
  const { offset, page, max_chars } = args;
  const meta = describeFile(file);
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
      error: errorName(error),
    });
    return jsonContent({
      ...meta,
      readable: false,
      note: 'The file could not be parsed: it may be corrupt, password-protected or in an unusual format.',
    });
  }

  if (reading.kind === 'unsupported') {
    logUnreadable(logger, file.mimeType, 'too large to return');
    return jsonContent({ ...meta, readable: false, note: joinNotes(modeNote, reading.reason) });
  }
  if (reading.kind === 'image') {
    logger.info('file parsed', {
      format,
      mode: ReadMode.Extract,
      mime: file.mimeType,
      bytes: meta.size_bytes,
      ms: Date.now() - started,
    });
    const image: ToolContent = { type: 'image', data: reading.base64, mimeType: reading.mimeType };
    return [
      image,
      ...jsonContent({
        ...meta,
        readable: true,
        mode: ReadMode.Extract,
        note: joinNotes(modeNote, 'The image is attached.'),
      }),
    ];
  }

  if (reading.kind === 'pdf') {
    const { chunk } = reading;
    const pagesRead =
      chunk.firstPage === undefined ? 0 : (chunk.lastPage ?? chunk.firstPage) - chunk.firstPage + 1;
    logger.info('file parsed', {
      format,
      mode: ReadMode.Extract,
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
      mode: ReadMode.Extract,
      pages: chunk.pages,
      page,
      offset,
      first_page: chunk.firstPage,
      last_page: chunk.lastPage,
      next_page: chunk.next?.page ?? null,
      next_offset: chunk.next?.offset ?? null,
      note: joinNotes(
        modeNote,
        page > chunk.pages
          ? `page is past the end of the document, which has ${chunk.pages} pages.`
          : noText
            ? 'No text found on these pages. A scanned or image-only document has no text layer.'
            : undefined,
      ),
      text: chunk.text,
    });
  }

  logger.info('file parsed', {
    format,
    mode: ReadMode.Extract,
    mime: file.mimeType,
    bytes: meta.size_bytes,
    pages: reading.pages,
    chars: reading.text.length,
    truncated: offset + max_chars < reading.text.length,
    ms: Date.now() - started,
  });
  return textResult(file, args, {
    format: reading.format,
    mode: ReadMode.Extract,
    text: reading.text,
    pages: reading.pages,
    note: joinNotes(modeNote, reading.encoding && encodingNote(reading.encoding)),
  });
}

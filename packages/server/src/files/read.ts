import type { DownloadedFile } from '../moodle/client.ts';
import { htmlToText } from './text.ts';

/** PDF.js `VerbosityLevel.ERRORS`: its font warnings ("TT: undefined function") are noise, the text still extracts. */
const PDFJS_ERRORS_ONLY = 0;

/** Largest image handed to the model as an image rather than described. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  html: 'text/html',
  htm: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const DOCX = MIME_BY_EXTENSION.docx;
const PPTX = MIME_BY_EXTENSION.pptx;
const XLSX = MIME_BY_EXTENSION.xlsx;

const TEXT_APPLICATION_TYPES: ReadonlySet<string> = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-sh',
  'application/x-yaml',
  'application/x-tex',
  'application/sql',
  'application/csv',
]);

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'txt',
  'md',
  'csv',
  'tsv',
  'json',
  'xml',
  'yaml',
  'yml',
  'log',
  'tex',
  'sql',
  'py',
  'js',
  'ts',
  'java',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'go',
  'rs',
  'rb',
  'php',
  'sh',
  'r',
  'm',
  'ipynb',
  'ini',
  'toml',
  'srt',
  'vtt',
  'rtf',
]);

export interface ReadOptions {
  /** Character offset to start from, for paging through long documents. */
  offset: number;
  /** Most characters to return. */
  maxChars: number;
}

export type FileReading =
  | { kind: 'text'; format: string; text: string; pages?: number }
  | { kind: 'image'; mimeType: string; base64: string }
  | { kind: 'unsupported'; reason: string };

const extensionOf = (filename: string) => /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase() ?? '';

/** Prefers the extension when the server only says "octet-stream", which Moodle does for many files. */
function effectiveType({ mimeType, filename }: Pick<DownloadedFile, 'mimeType' | 'filename'>): string {
  const generic =
    mimeType === '' || mimeType === 'application/octet-stream' || mimeType === 'application/force-download';
  return generic ? (MIME_BY_EXTENSION[extensionOf(filename)] ?? mimeType) : mimeType;
}

const decodeUtf8 = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes);

type Kind = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'html' | 'image' | 'text';

/** What we can do with a file, judged from its metadata alone (so unreadable files are never downloaded). */
export function classify(meta: Pick<DownloadedFile, 'mimeType' | 'filename'>): Kind | null {
  const type = effectiveType(meta);
  if (type === 'application/pdf') return 'pdf';
  if (type === DOCX) return 'docx';
  if (type === PPTX) return 'pptx';
  if (type === XLSX) return 'xlsx';
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (IMAGE_TYPES.has(type)) return 'image';
  if (type.startsWith('text/') || TEXT_APPLICATION_TYPES.has(type)) return 'text';
  // Moodle labels much source code with odd types, so trust the extension, but never over media.
  const media = type.startsWith('video/') || type.startsWith('audio/');
  return !media && TEXT_EXTENSIONS.has(extensionOf(meta.filename)) ? 'text' : null;
}

export const unsupportedReason = (meta: Pick<DownloadedFile, 'mimeType' | 'filename'>) =>
  `Cannot extract text from ${effectiveType(meta) || 'this file type'}. Supported: PDF, DOCX, PPTX, XLSX, HTML, images and plain-text files.`;

/**
 * Extracts what a model can read from a downloaded file. The parsers (PDF.js, fflate) are large and most
 * requests never read a document, so each is loaded on first use rather than when the Worker starts.
 */
export async function readFile(file: DownloadedFile): Promise<FileReading> {
  switch (classify(file)) {
    case 'pdf': {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(file.bytes), { verbosity: PDFJS_ERRORS_ONLY });
      const { text, totalPages } = await extractText(pdf, { mergePages: true });
      return { kind: 'text', format: 'pdf', text: text.trim(), pages: totalPages };
    }
    case 'docx': {
      const { docxText } = await import('./office.ts');
      return { kind: 'text', format: 'docx', text: docxText(file.bytes) };
    }
    case 'pptx': {
      const { pptxText } = await import('./office.ts');
      const { text, slides } = pptxText(file.bytes);
      return { kind: 'text', format: 'pptx', text, pages: slides };
    }
    case 'xlsx': {
      const { xlsxText } = await import('./xlsx.ts');
      const { text, sheets } = xlsxText(file.bytes);
      return { kind: 'text', format: 'xlsx', text, pages: sheets };
    }
    case 'html':
      return { kind: 'text', format: 'html', text: htmlToText(decodeUtf8(file.bytes)) };
    case 'image':
      if (file.bytes.byteLength > MAX_IMAGE_BYTES) {
        return { kind: 'unsupported', reason: 'The image is larger than 4 MB, which is too big to return.' };
      }
      return { kind: 'image', mimeType: effectiveType(file), base64: toBase64(file.bytes) };
    case 'text':
      return { kind: 'text', format: extensionOf(file.filename) || 'text', text: decodeUtf8(file.bytes) };
    case null:
      return { kind: 'unsupported', reason: unsupportedReason(file) };
  }
}

/** Slices `text` for paging; `nextOffset` is null once the end is reached. */
export function pageText(text: string, { offset, maxChars }: ReadOptions) {
  const slice = text.slice(offset, offset + maxChars);
  const end = offset + slice.length;
  return { slice, totalChars: text.length, nextOffset: end < text.length ? end : null };
}

/** `btoa` over chunks, because spreading a large array into `String.fromCharCode` overflows the stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

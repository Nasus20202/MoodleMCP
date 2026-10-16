import type { DownloadedFile } from '../moodle/client.ts';
import { classify, DOCX, effectiveType, PPTX, XLSX } from './read.ts';
import { listZip } from './zip.ts';

/** Bytes looked at when deciding whether a file is text. */
const SNIFF_BYTES = 8192;

/** Types a server says when it does not know the real one. */
export const isGenericType = (type: string) =>
  type === '' || type === 'application/octet-stream' || type === 'application/force-download';

interface Signature {
  type: string;
  /** Where the bytes start; the formats below all begin at 0 except MP4's `ftyp`. */
  at: number;
  bytes: readonly number[];
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** The few formats whose first bytes the format itself fixes. */
const SIGNATURES: readonly Signature[] = [
  { type: 'application/pdf', at: 0, bytes: ascii('%PDF-') },
  { type: 'application/zip', at: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  { type: 'image/png', at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', at: 0, bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', at: 0, bytes: ascii('GIF8') },
  { type: 'video/mp4', at: 4, bytes: ascii('ftyp') },
  { type: 'application/gzip', at: 0, bytes: [0x1f, 0x8b] },
];

const startsWith = (bytes: Uint8Array, { at, bytes: signature }: Signature) =>
  bytes.length >= at + signature.length && signature.every((byte, i) => bytes[at + i] === byte);

/** WebP is a RIFF container, so its signature is split around the length field. */
const isWebp = (bytes: Uint8Array) =>
  startsWith(bytes, { type: '', at: 0, bytes: ascii('RIFF') }) &&
  startsWith(bytes, { type: '', at: 8, bytes: ascii('WEBP') });

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1250';

/** Share of control characters above which a window is taken for binary. */
const MAX_CONTROL_SHARE = 0.02;

const isControl = (code: number) =>
  code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 27;

/**
 * The encoding the start of `bytes` is text in, or null when it is not text: a UTF-16 byte order mark, valid
 * UTF-8, or else, when there is no NUL and almost no control byte, a single-byte codepage (Windows-1250,
 * which Polish course files are often saved in). A byte sequence cut in half by the end of the window is not
 * held against UTF-8.
 */
export function textEncoding(bytes: Uint8Array): TextEncoding | null {
  const head = bytes.subarray(0, SNIFF_BYTES);
  if (head.length === 0) return 'utf-8';
  if (head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  if (head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
  if (head.includes(0)) return null;
  let controls = 0;
  for (const byte of head) if (isControl(byte)) controls++;
  if (controls / head.length >= MAX_CONTROL_SHARE) return null;
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(head, {
      stream: head.length < bytes.length,
    });
    return 'utf-8';
  } catch {
    return 'windows-1250';
  }
}

/** Decodes text in the encoding it appears to be in; the encoding is returned so a guess can be reported. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: TextEncoding } {
  const encoding = textEncoding(bytes) ?? 'utf-8';
  return { text: new TextDecoder(encoding).decode(bytes), encoding };
}

/** Said when text had to be decoded in something other than UTF-8. */
export const encodingNote = (encoding: TextEncoding): string | undefined =>
  encoding === 'utf-8'
    ? undefined
    : `The file is not UTF-8, so it was decoded as ${encoding}; some characters may be wrong.`;

const HTML_START = /^\s*(?:<!doctype\s+html|<html[\s>])/i;

/** The media type the content itself shows, or null when it is none of the few known formats nor text. */
export function sniffType(bytes: Uint8Array): string | null {
  if (isWebp(bytes)) return 'image/webp';
  const signature = SIGNATURES.find((candidate) => startsWith(bytes, candidate));
  if (signature) return signature.type;
  const encoding = textEncoding(bytes);
  if (encoding === null) return null;
  const start = new TextDecoder(encoding).decode(bytes.subarray(0, 512));
  return HTML_START.test(start) ? 'text/html' : 'text/plain';
}

const OFFICE_BY_ENTRY: readonly (readonly [string, string])[] = [
  ['word/document.xml', DOCX],
  ['ppt/presentation.xml', PPTX],
  ['xl/workbook.xml', XLSX],
];

/** A ZIP that is really a Word, PowerPoint or Excel file shows it by the parts it holds. */
function officeType(bytes: Uint8Array): string | null {
  try {
    const names = new Set(listZip(bytes).entries.map((entry) => entry.path));
    return OFFICE_BY_ENTRY.find(([part]) => names.has(part))?.[1] ?? null;
  } catch {
    return null;
  }
}

const isMedia = (type: string) => type.startsWith('video/') || type.startsWith('audio/');

/** Whether a file the server could not name is worth reading in full: its content is a type we can read. */
export const readableByContent = (head: Uint8Array): boolean => {
  const type = sniffType(head);
  return type !== null && classify({ filename: '', mimeType: type }) !== null;
};

/**
 * What to do with a file's headers alone: read it, skip it, or look at its first bytes to decide. Declared
 * audio and video are never opened.
 */
export function judge(meta: Pick<DownloadedFile, 'mimeType' | 'filename'>): boolean | 'peek' {
  if (classify(meta) !== null) return true;
  return isMedia(effectiveType(meta)) ? false : 'peek';
}

/**
 * Names the type of a file that neither its server nor its extension identified, from its content. A file
 * whose type is already known, declared as audio or video, or refused unread, is returned as it is.
 */
export function withSniffedType(file: DownloadedFile): DownloadedFile {
  if (file.skipped || classify(file) !== null || isMedia(effectiveType(file))) return file;
  const sniffed = sniffType(file.bytes);
  const type = sniffed === 'application/zip' ? (officeType(file.bytes) ?? sniffed) : sniffed;
  return type === null ? file : { ...file, mimeType: type };
}

import type { DownloadedFile } from '../moodle/client.ts';
import { classify, effectiveType } from './read.ts';

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

/**
 * Whether the start of `bytes` is text: valid UTF-8 with no NUL and almost no control characters. A byte
 * sequence cut in half by the end of the window is not held against it.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, SNIFF_BYTES);
  if (head.length === 0) return true;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(head, {
      stream: head.length < bytes.length,
    });
  } catch {
    return false;
  }
  let control = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0) return false;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13 && code !== 12 && code !== 27) control++;
  }
  return control / text.length < 0.02;
}

/** The media type the content itself shows, or null when it is none of the few known formats nor text. */
export function sniffType(bytes: Uint8Array): string | null {
  if (isWebp(bytes)) return 'image/webp';
  const signature = SIGNATURES.find((candidate) => startsWith(bytes, candidate));
  if (signature) return signature.type;
  return looksLikeText(bytes) ? 'text/plain' : null;
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
  const type = sniffType(file.bytes);
  return type === null ? file : { ...file, mimeType: type };
}

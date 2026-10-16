import { describe, expect, it } from 'vitest';

import type { DownloadedFile } from '../moodle/client.ts';
import { looksLikeText, sniffType, withSniffedType } from './sniff.ts';

const bytes = (text: string) => new TextEncoder().encode(text);
const file = (filename: string, body: Uint8Array, mimeType = 'application/octet-stream'): DownloadedFile => ({
  bytes: body,
  filename,
  mimeType,
  skipped: false,
});

describe('sniffType', () => {
  it.each([
    ['PDF', bytes('%PDF-1.7\n'), 'application/pdf'],
    ['ZIP', new Uint8Array([0x50, 0x4b, 3, 4, 0]), 'application/zip'],
    ['PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), 'image/png'],
    ['JPEG', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    ['GIF', bytes('GIF89a'), 'image/gif'],
    ['WebP', bytes('RIFF\0\0\0\0WEBPVP8 '), 'image/webp'],
    ['MP4', new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), 'video/mp4'],
    ['source code', bytes('fun main() = println("zażółć")\n'), 'text/plain'],
    ['nothing', new Uint8Array(), 'text/plain'],
  ])('%s', (_name, body, expected) => {
    expect(sniffType(body)).toBe(expected);
  });

  it('gives up on other binary data', () => {
    expect(sniffType(new Uint8Array([0, 1, 2, 3, 4]))).toBeNull();
    expect(sniffType(new Uint8Array([0xff, 0xfe, 0xfd, 0x80]))).toBeNull();
  });
});

describe('looksLikeText', () => {
  it('is not fooled by a multi-byte character cut off by the end of the window', () => {
    expect(looksLikeText(bytes('a'.repeat(8191) + 'ż'))).toBe(true);
  });

  it('rejects text with a NUL byte or many control characters', () => {
    expect(looksLikeText(bytes('abc\0def'))).toBe(false);
    expect(looksLikeText(bytes('\u0001\u0002\u0003abc'))).toBe(false);
  });
});

describe('withSniffedType', () => {
  it('names a file of generic type from its content', () => {
    expect(withSniffedType(file('Main.kt', bytes('fun main() = Unit'))).mimeType).toBe('text/plain');
    expect(withSniffedType(file('picture', bytes('GIF89a'), '')).mimeType).toBe('image/gif');
  });

  it('leaves files whose type is known, or that were not downloaded, alone', () => {
    const known = file('a.pdf', bytes('not a pdf'));
    expect(withSniffedType(known)).toBe(known);
    const typed = file('a.bin', bytes('text'), 'application/x-custom');
    expect(withSniffedType(typed)).toBe(typed);
    const skipped = { ...file('a.bin', new Uint8Array()), skipped: true };
    expect(withSniffedType(skipped)).toBe(skipped);
  });
});

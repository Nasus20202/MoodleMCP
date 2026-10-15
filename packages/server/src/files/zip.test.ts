import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  listZip,
  MAX_ENTRY_BYTES,
  MAX_ENTRY_PATH_LENGTH,
  MAX_LISTED_ENTRIES,
  unzipEntry,
  unzipText,
  ZipEntryTooLargeError,
} from './zip.ts';

/** Overwrites the uncompressed size the central directory declares for the archive's only entry. */
function forgeDeclaredSize(zip: Uint8Array, size: number): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let at = 0; at < zip.length - 4; at++) {
    if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 24, size, true);
  }
  return zip;
}

describe('unzipText', () => {
  it('reads deflated and stored entries, and only the wanted ones', () => {
    const zip = zipSync({
      'a.xml': [strToU8('<a>deflated é</a>'), { level: 9 }],
      'b.xml': [strToU8('<b>stored</b>'), { level: 0 }],
      'c.xml': strToU8('<c>skipped</c>'),
    });
    const files = unzipText(zip, (name) => name !== 'c.xml');
    expect(Object.fromEntries(files)).toEqual({ 'a.xml': '<a>deflated é</a>', 'b.xml': '<b>stored</b>' });
  });

  it('never inflates past the size an entry declares, even a forged one', () => {
    const bomb = forgeDeclaredSize(zipSync({ 'x.xml': new Uint8Array(41 * 1024 * 1024) }), 10);
    expect(unzipText(bomb, () => true).get('x.xml')).toHaveLength(10);
  });

  it('rejects something that is not a zip archive', () => {
    expect(() => unzipText(strToU8('not a zip at all, just some text'), () => true)).toThrow();
  });
});

describe('listZip', () => {
  it('lists files with their sizes and leaves directories out, without inflating anything', () => {
    const zip = zipSync({
      'src/': new Uint8Array(),
      'src/A.kt': strToU8('class A'),
      'readme.txt': strToU8('hello'),
    });
    expect(listZip(zip)).toEqual({
      entries: [
        { path: 'src/A.kt', size: 7 },
        { path: 'readme.txt', size: 5 },
      ],
      total: 2,
    });
  });

  it('stops listing at the limit but still counts every file', () => {
    const files = Object.fromEntries(
      Array.from({ length: MAX_LISTED_ENTRIES + 5 }, (_, i) => [`f${i}.txt`, strToU8('x')]),
    );
    const listing = listZip(zipSync(files));
    expect(listing.entries).toHaveLength(MAX_LISTED_ENTRIES);
    expect(listing.total).toBe(MAX_LISTED_ENTRIES + 5);
  });

  it('rejects something that is not a zip archive', () => {
    expect(() => listZip(strToU8('not a zip at all, just some text'))).toThrow();
  });
});

describe('unzipEntry', () => {
  const zip = zipSync({ 'a/b.txt': strToU8('bee'), 'c.txt': strToU8('sea') });

  it('inflates only the entry asked for, matched by its exact path', () => {
    expect(new TextDecoder().decode(unzipEntry(zip, 'a/b.txt'))).toBe('bee');
    expect(unzipEntry(zip, 'b.txt')).toBeUndefined();
    expect(unzipEntry(zip, '../c.txt')).toBeUndefined();
    expect(unzipEntry(zip, 'a/')).toBeUndefined();
  });

  it('refuses an entry that declares more than the limit, before inflating it', () => {
    const big = zipSync({ 'x.bin': new Uint8Array(MAX_ENTRY_BYTES + 1) });
    expect(() => unzipEntry(big, 'x.bin')).toThrow(ZipEntryTooLargeError);
  });

  it('never inflates past the size an entry declares, even a forged one', () => {
    const bomb = forgeDeclaredSize(zipSync({ 'x.bin': new Uint8Array(MAX_ENTRY_BYTES - 1) }), 10);
    expect(unzipEntry(bomb, 'x.bin')).toHaveLength(10);
  });
});

describe('archives with hostile names', () => {
  /** Renames every `from` in the archive to `to` (same length), in both the local and central headers. */
  function rename(zip: Uint8Array, from: string, to: string): Uint8Array {
    const needle = strToU8(from);
    for (let at = 0; at < zip.length - needle.length; at++) {
      if (needle.every((byte, i) => zip[at + i] === byte)) zip.set(strToU8(to), at);
    }
    return zip;
  }

  it('reads the first of several entries with the same name, and only that one', () => {
    const zip = rename(
      zipSync({ 'a.txt': strToU8('first'), 'b.txt': strToU8('second') }, { level: 0 }),
      'b.txt',
      'a.txt',
    );
    expect(listZip(zip).entries.map((e) => e.path)).toEqual(['a.txt', 'a.txt']);
    expect(new TextDecoder().decode(unzipEntry(zip, 'a.txt'))).toBe('first');
  });

  it('does not find an entry that is only a property of plain objects', () => {
    const zip = zipSync({ 'a.txt': strToU8('a') });
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(unzipEntry(zip, name)).toBeUndefined();
    }
  });

  it('counts but does not list entries whose path is too long to ask for', () => {
    const long = 'd/'.repeat(MAX_ENTRY_PATH_LENGTH) + 'f.txt';
    const listing = listZip(zipSync({ [long]: strToU8('x'), 'short.txt': strToU8('y') }));
    expect(listing.entries.map((e) => e.path)).toEqual(['short.txt']);
    expect(listing.total).toBe(2);
  });
});

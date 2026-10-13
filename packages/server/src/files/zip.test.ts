import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { unzipText } from './zip.ts';

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

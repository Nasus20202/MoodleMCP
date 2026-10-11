import { unzipSync } from 'fflate';

/** Refuse archives that would inflate to more than this (zip bombs). */
const MAX_INFLATED_BYTES = 40 * 1024 * 1024;

const decoder = new TextDecoder();

/** Unzips only the entries `wanted` accepts, checking declared sizes before inflating anything. */
export function unzipText(bytes: Uint8Array, wanted: (name: string) => boolean): Map<string, string> {
  let budget = MAX_INFLATED_BYTES;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (!wanted(file.name)) return false;
      budget -= file.originalSize;
      if (budget < 0) throw new Error('Archive is too large to read');
      return true;
    },
  });
  return new Map(Object.entries(files).map(([name, data]) => [name, decoder.decode(data)]));
}

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

/** The most entries listed; larger archives are listed up to here and reported as truncated. */
export const MAX_LISTED_ENTRIES = 500;

/** The most one entry may inflate to when it is read on its own. */
export const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

export interface ZipEntry {
  path: string;
  /** Uncompressed size as the archive declares it. */
  size: number;
}

export interface ZipListing {
  entries: ZipEntry[];
  /** Files in the archive, whether or not they were listed. */
  total: number;
}

/** An entry that would inflate past the limit. */
export class ZipEntryTooLargeError extends Error {
  override name = 'ZipEntryTooLargeError';
}

/** Lists the files of an archive without inflating any of them. Directories are left out. */
export function listZip(bytes: Uint8Array): ZipListing {
  const entries: ZipEntry[] = [];
  let total = 0;
  unzipSync(bytes, {
    filter: (file) => {
      if (!file.name.endsWith('/')) {
        total++;
        if (entries.length < MAX_LISTED_ENTRIES) entries.push({ path: file.name, size: file.originalSize });
      }
      return false;
    },
  });
  return { entries, total };
}

/**
 * Inflates the one entry called `path`, or returns undefined when there is none. The name is only compared,
 * never used as a path. The size is checked before inflating, and fflate never inflates past the declared
 * size, so a forged header cannot get around the limit.
 */
export function unzipEntry(bytes: Uint8Array, path: string): Uint8Array | undefined {
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (file.name !== path || file.name.endsWith('/')) return false;
      if (file.originalSize > MAX_ENTRY_BYTES) throw new ZipEntryTooLargeError('Entry is too large to read');
      return true;
    },
  });
  return files[path];
}

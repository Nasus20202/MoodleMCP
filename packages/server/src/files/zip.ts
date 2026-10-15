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

/** Longest entry path listed, which is also the longest `entry` argument that could ask for one. */
export const MAX_ENTRY_PATH_LENGTH = 1024;

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

/**
 * Lists the files of an archive without inflating any of them. Directories are left out, and so are files whose
 * path is too long to ask for, though they still count towards `total`.
 */
export function listZip(bytes: Uint8Array): ZipListing {
  const entries: ZipEntry[] = [];
  let total = 0;
  unzipSync(bytes, {
    filter: (file) => {
      if (!file.name.endsWith('/')) {
        total++;
        if (entries.length < MAX_LISTED_ENTRIES && file.name.length <= MAX_ENTRY_PATH_LENGTH) {
          entries.push({ path: file.name, size: file.originalSize });
        }
      }
      return false;
    },
  });
  return { entries, total };
}

/**
 * Inflates the one entry called `path`, or returns undefined when there is none. The name is only compared,
 * never used as a path. The size is checked before inflating, and fflate never inflates past the declared
 * size, so a forged header cannot get around the limit. When several entries share the name only the first is
 * inflated, so repeating one name cannot multiply the work.
 */
export function unzipEntry(bytes: Uint8Array, path: string): Uint8Array | undefined {
  let found = false;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (found || file.name !== path || file.name.endsWith('/')) return false;
      if (file.originalSize > MAX_ENTRY_BYTES) throw new ZipEntryTooLargeError('Entry is too large to read');
      found = true;
      return true;
    },
  });
  // The result is a plain object, so a missing entry called "constructor" would otherwise be found.
  return found ? files[path] : undefined;
}

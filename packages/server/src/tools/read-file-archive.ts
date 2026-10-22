import { classify, effectiveType, isGenericType } from '../files/read.ts';
import { listZip, MAX_ENTRY_BYTES, unzipEntry, ZipEntryTooLargeError } from '../files/zip.ts';
import type { Logger } from '../logger.ts';
import type { DownloadedFile } from '../moodle/client.ts';
import { jsonContent, type ToolContent } from './define.ts';
import { DEFAULT_CHARS, describeFile, errorName, logUnreadable } from './read-file-results.ts';

/** The paging arguments. They do not apply to a listing, only to reading an entry. */
interface Paging {
  offset: number;
  page: number;
  max_chars: number;
}

/** What an archive holds, without inflating any of it. */
export function listArchive(
  logger: Logger,
  file: DownloadedFile,
  { offset, page, max_chars }: Paging,
): ToolContent[] {
  let listing;
  try {
    listing = listZip(file.bytes);
  } catch (error) {
    logger.warn('file parse failed', {
      format: 'zip',
      mime: file.mimeType,
      bytes: file.bytes.byteLength,
      error: errorName(error),
    });
    return jsonContent({
      ...describeFile(file),
      readable: false,
      note: 'The archive could not be opened: it may be corrupt or in an unusual format.',
    });
  }
  logger.info('archive listed', { bytes: file.bytes.byteLength, entries: listing.total });
  const entries = listing.entries.map(({ path, size }) => {
    const entry = { filename: basename(path), mimeType: '' };
    const kind = classify(entry);
    const type = effectiveType(entry);
    return {
      path,
      size_bytes: size,
      type: type || null,
      // Nothing is inflated to list, so a name that says nothing about the content is left open.
      readable: kind !== null ? kind !== 'zip' : isGenericType(type) ? ('unknown' as const) : false,
    };
  });
  const truncated = listing.total > entries.length;
  const paged = offset > 0 || page > 1 || max_chars !== DEFAULT_CHARS;
  return jsonContent({
    ...describeFile(file),
    readable: true,
    format: 'zip',
    entry_count: listing.total,
    truncated: truncated ? true : undefined,
    note:
      'To read one of the files, call read_file again with `entry` set to its path. Entries marked ' +
      'readable: false cannot be turned into text; for readable: "unknown" the name does not say, so try it.' +
      (truncated ? ` Not every entry is listed: ${entries.length} of ${listing.total} are shown.` : '') +
      (paged
        ? ' offset, page and max_chars do not apply to a listing; they are used when reading an entry.'
        : ''),
    entries,
  });
}

/** The outcome of opening one entry: the file to read, or the note saying why it cannot be read. */
export type EntryOpening = { ok: true; file: DownloadedFile } | { ok: false; note: string };

/** Inflates one entry of an archive, as a file of its own. */
export function openEntry(archive: DownloadedFile, path: string, logger: Logger): EntryOpening {
  let bytes;
  try {
    bytes = unzipEntry(archive.bytes, path);
  } catch (error) {
    if (error instanceof ZipEntryTooLargeError) {
      logUnreadable(logger, archive.mimeType, 'entry too large');
      return {
        ok: false,
        note: `That entry is larger than ${MAX_ENTRY_BYTES / 1024 / 1024} MB, which is too big to read.`,
      };
    }
    logger.warn('file parse failed', {
      format: 'zip',
      mime: archive.mimeType,
      bytes: archive.bytes.byteLength,
      error: errorName(error),
    });
    return {
      ok: false,
      note: 'That entry could not be read: the archive may be corrupt or password-protected.',
    };
  }
  if (bytes === undefined) {
    logUnreadable(logger, archive.mimeType, 'no such entry');
    return {
      ok: false,
      note: 'The archive has no entry with that path. Call read_file without `entry` to list them.',
    };
  }
  logger.info('archive entry read', { bytes: bytes.byteLength });
  const filename = basename(path);
  return {
    ok: true,
    file: { bytes, filename, mimeType: effectiveType({ filename, mimeType: '' }), skipped: false },
  };
}

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

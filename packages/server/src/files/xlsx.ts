import { cellText, markdownTable } from './table.ts';
import { decodeEntities } from './text.ts';
import { unzipText } from './zip.ts';

/** One compiled pattern per attribute name: building a RegExp for every cell dominated large sheets. */
const ATTR_PATTERNS = new Map<string, RegExp>();

/** Value of an XML attribute in `tag`, entity-decoded. */
function attr(tag: string, name: string): string | undefined {
  let pattern = ATTR_PATTERNS.get(name);
  if (!pattern) ATTR_PATTERNS.set(name, (pattern = new RegExp(`\\b${name}="([^"]*)"`)));
  const value = pattern.exec(tag)?.[1];
  return value === undefined ? undefined : decodeEntities(value);
}

/** Text inside every `<t>` of a shared string or inline string item. */
const stringItem = (xml: string) =>
  decodeEntities([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

/** 0-based column index of a cell reference such as "AB12". */
function columnOf(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '') n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** Excel's built-in date and time number formats; custom ones (id 164 and up) are judged by their code. */
const BUILTIN_DATE_FORMATS = new Set([
  ...[14, 15, 16, 17, 18, 19, 20, 21, 22],
  ...[27, 28, 29, 30, 31, 32, 33, 34, 35, 36],
  ...[45, 46, 47],
  ...[50, 51, 52, 53, 54, 55, 56, 57, 58],
]);

/** Built-in formats that show a time of day (alone or with a date). */
const BUILTIN_TIME_FORMATS = new Set([18, 19, 20, 21, 22, 32, 33, 45, 46, 47]);

/** A format code without its quoted text, bracketed conditions and escaped characters. */
const stripped = (code: string) => code.toLowerCase().replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');

/** A custom number format is a date format when, outside quotes, brackets and escapes, it has date or time letters. */
const isDateCode = (code: string) => /[dmyhs]/.test(stripped(code)) && !/^general$/i.test(code);

/** The indexes of the cell styles (the `s` of a cell) whose number format is a date or time, and whether it has a time. */
function dateStyles(stylesXml: string): Map<number, { time: boolean }> {
  const codes = new Map(
    [...stylesXml.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [
      Number(attr(m[0], 'numFmtId')),
      attr(m[0], 'formatCode') ?? '',
    ]),
  );
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  const styles = new Map<number, { time: boolean }>();
  [...cellXfs.matchAll(/<xf\b[^>]*>/g)].forEach((xf, index) => {
    const id = Number(attr(xf[0], 'numFmtId') ?? 0);
    const code = codes.get(id);
    const date = code === undefined ? BUILTIN_DATE_FORMATS.has(id) : isDateCode(code);
    if (date) {
      const time = code === undefined ? BUILTIN_TIME_FORMATS.has(id) : /[hs]/i.test(stripped(code));
      styles.set(index, { time });
    }
  });
  return styles;
}

/** An Excel serial number (days since 1899-12-30) as `YYYY-MM-DD`, with the time of day when the format has one. */
function serialToText(serial: number, time: boolean): string {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400) * 1000);
  const iso = date.toISOString();
  const clock = iso.slice(11, 16) + (iso.slice(17, 19) === '00' ? '' : iso.slice(16, 19));
  if (serial >= 0 && serial < 1) return clock;
  return time && !Number.isInteger(serial) ? `${iso.slice(0, 10)} ${clock}` : iso.slice(0, 10);
}

/** The displayed value of one `<c>` element: strings are looked up, booleans spelled out. */
function cellValue(
  type: string | undefined,
  body: string,
  shared: readonly string[],
  date: { time: boolean } | undefined,
): string {
  const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
  switch (type) {
    case 's':
      return shared[Number(raw)] ?? '';
    case 'inlineStr':
      return stringItem(body);
    case 'b':
      return raw === '1' ? 'TRUE' : 'FALSE';
    default: {
      const value = decodeEntities(raw);
      return date && value !== '' && Number.isFinite(Number(value))
        ? serialToText(Number(value), date.time)
        : value;
    }
  }
}

function sheetRows(
  xml: string,
  shared: readonly string[],
  dates: ReadonlyMap<number, { time: boolean }>,
): string[][] {
  const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells: string[] = [];
    for (const [, attrs = '', body = ''] of (row[1] ?? '').matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const style = Number(attr(attrs, 's'));
      cells[columnOf(attr(attrs, 'r') ?? '')] = cellText(
        cellValue(attr(attrs, 't'), body, shared, dates.get(style)),
      );
    }
    return Array.from(cells, (c) => c ?? '');
  });
  while (rows.length > 0 && (rows[rows.length - 1] ?? []).every((c) => c === '')) rows.pop();
  return rows;
}

/**
 * Text of a .xlsx: one Markdown table per sheet, its first row as the header. Cached formula results are
 * shown, and cells with a date or time number format are written as dates.
 */
export function xlsxText(bytes: Uint8Array): { text: string; sheets: number } {
  const files = unzipText(
    bytes,
    (name) =>
      name === 'xl/workbook.xml' ||
      name === 'xl/_rels/workbook.xml.rels' ||
      name === 'xl/sharedStrings.xml' ||
      name === 'xl/styles.xml' ||
      /^xl\/worksheets\/[\w-]+\.xml$/.test(name),
  );
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(
    (m) => stringItem(m[1] ?? ''),
  );
  const targets = new Map(
    [...(files.get('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      attr(m[0], 'Id') ?? '',
      (attr(m[0], 'Target') ?? '').replace(/^\/?(xl\/)?/, 'xl/'),
    ]),
  );

  const dates = dateStyles(files.get('xl/styles.xml') ?? '');
  const blocks = [...(files.get('xl/workbook.xml') ?? '').matchAll(/<sheet\b[^>]*>/g)].map(([tag]) => {
    const xml = files.get(targets.get(attr(tag, 'r:id') ?? '') ?? '') ?? '';
    return `--- Sheet: ${attr(tag, 'name') ?? 'Sheet'} ---\n${markdownTable(sheetRows(xml, shared, dates))}`;
  });
  return { text: blocks.join('\n\n'), sheets: blocks.length };
}

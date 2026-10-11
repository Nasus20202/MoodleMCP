import { decodeEntities } from './text.ts';
import { unzipText } from './zip.ts';

/** Value of an XML attribute in `tag`, entity-decoded. */
function attr(tag: string, name: string): string | undefined {
  const value = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
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

const tsvCell = (value: string) => value.replace(/[\t\r\n]+/g, ' ');

/** The displayed value of one `<c>` element: strings are looked up, booleans spelled out. */
function cellValue(type: string | undefined, body: string, shared: readonly string[]): string {
  const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
  switch (type) {
    case 's':
      return shared[Number(raw)] ?? '';
    case 'inlineStr':
      return stringItem(body);
    case 'b':
      return raw === '1' ? 'TRUE' : 'FALSE';
    default:
      return decodeEntities(raw);
  }
}

function sheetRows(xml: string, shared: readonly string[]): string[] {
  const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells: string[] = [];
    for (const [, attrs = '', body = ''] of (row[1] ?? '').matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      cells[columnOf(attr(attrs, 'r') ?? '')] = tsvCell(cellValue(attr(attrs, 't'), body, shared));
    }
    return Array.from(cells, (c) => c ?? '').join('\t');
  });
  while (rows.length > 0 && /^\t*$/.test(rows[rows.length - 1] ?? '')) rows.pop();
  return rows;
}

/**
 * Text of a .xlsx: one tab-separated block per sheet. Cached formula results are shown; dates appear
 * as Excel serial numbers because the cell formatting is not interpreted.
 */
export function xlsxText(bytes: Uint8Array): { text: string; sheets: number } {
  const files = unzipText(
    bytes,
    (name) =>
      name === 'xl/workbook.xml' ||
      name === 'xl/_rels/workbook.xml.rels' ||
      name === 'xl/sharedStrings.xml' ||
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

  const blocks = [...(files.get('xl/workbook.xml') ?? '').matchAll(/<sheet\b[^>]*>/g)].map(([tag]) => {
    const xml = files.get(targets.get(attr(tag, 'r:id') ?? '') ?? '') ?? '';
    return `--- Sheet: ${attr(tag, 'name') ?? 'Sheet'} ---\n${sheetRows(xml, shared).join('\n')}`;
  });
  return { text: blocks.join('\n\n'), sheets: blocks.length };
}

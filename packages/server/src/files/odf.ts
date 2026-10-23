import { decodeEntities } from './text.ts';
import { unzipText } from './zip.ts';

export const ODT = 'application/vnd.oasis.opendocument.text';
export const ODS = 'application/vnd.oasis.opendocument.spreadsheet';
export const ODP = 'application/vnd.oasis.opendocument.presentation';

export const ODF_TYPES: ReadonlySet<string> = new Set([ODT, ODS, ODP]);

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? undefined;

/**
 * Text of a LibreOffice / OpenDocument file (.odt, .ods, .odp), from its `content.xml`. Spreadsheets give one
 * tab-separated block per sheet and presentations one block per slide. Unlike Word and Excel files, tables are not
 * turned into Markdown here.
 */
export function odfText(bytes: Uint8Array, type: string): { text: string; pages?: number } {
  const xml = unzipText(bytes, (name) => name === 'content.xml').get('content.xml') ?? '';
  const body = /<office:body>([\s\S]*)<\/office:body>/.exec(xml)?.[1] ?? xml;
  let pages = 0;
  const marked = body
    .replace(/<draw:page\s[^>]*>/g, () => (type === ODP ? `\n--- Slide ${++pages} ---\n` : ''))
    .replace(/<table:table\s([^>]*)>/g, (_tag, attrs: string) =>
      type === ODS ? `\n--- Sheet ${++pages}: ${decodeEntities(attr(attrs, 'table:name') ?? '')} ---\n` : '',
    );
  const text = decodeEntities(
    marked
      .replace(
        /<table:table-cell\b[^>]*(?<!\/)>([\s\S]*?)<\/table:table-cell>/g,
        (_cell, inner: string) => `${inner.replace(/<\/text:p>/g, ' ')}</table:table-cell>`,
      )
      .replace(/<text:tab\b[^>]*\/>/g, '\t')
      .replace(/<text:line-break\b[^>]*\/>/g, '\n')
      .replace(/<text:s\b([^>]*)\/>/g, (_tag, attrs: string) =>
        ' '.repeat(Math.min(Number(attr(attrs, 'text:c') ?? 1), 64)),
      )
      .replace(/<table:table-cell\b[^>]*\/>/g, '\t')
      .replace(/<\/table:table-cell>/g, '\t')
      .replace(/<\/(?:text:p|text:h|table:table-row)>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/ +\t/g, '\t')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return pages > 0 ? { text, pages } : { text };
}

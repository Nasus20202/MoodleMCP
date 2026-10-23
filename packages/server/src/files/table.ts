/** A cell's text on one line, safe inside a pipe table. */
export const cellText = (text: string) => text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

/**
 * A Markdown (pipe) table; the first row is the header. Rows are padded to the widest one. Cells must
 * already be single-line (see {@link cellText}).
 */
export function markdownTable(rows: readonly (readonly string[])[]): string {
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (width === 0) return '';
  const pad = (r: readonly string[]) =>
    `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  const [head = [], ...body] = rows;
  return [pad(head), `|${' --- |'.repeat(width)}`, ...body.map(pad)].join('\n');
}

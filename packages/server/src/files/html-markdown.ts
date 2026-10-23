import { decodeEntities } from './text.ts';

/** Elements whose content is never text for a reader. */
const SKIPPED = new Set(['script', 'style', 'head', 'svg', 'noscript', 'template']);

/** Elements that start and end a paragraph-sized block. */
const BLOCKS = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'aside',
  'main',
  'nav',
  'figure',
  'figcaption',
  'details',
  'summary',
  'dl',
  'dt',
  'dd',
  'address',
]);

/**
 * One piece of HTML: a comment, a tag (group 1 is `/` for a closing tag, group 2 the name, group 3 the
 * attributes, which may hold `>` inside quotes), a run of text, or a stray `<`.
 */
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|[^<]+|</g;

/** One attribute: group 1 the name, then its value in double quotes, single quotes, or bare. */
const ATTRIBUTE = /([a-zA-Z_:][-\w:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function attributes(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    found.set((match[1] ?? '').toLowerCase(), decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return found;
}

interface ListFrame {
  ordered: boolean;
  count: number;
}

interface TableFrame {
  rows: string[][];
  row: string[];
}

/** Trailing blanks dropped and runs of blank lines squeezed to one. */
const tidyBlocks = (text: string) =>
  text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** A cell's text on one line, safe inside a pipe table. */
const cell = (text: string) => text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

function renderTable(rows: string[][]): string {
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (width === 0) return '';
  const pad = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  const [head = [], ...body] = rows;
  return [pad(head), `|${' --- |'.repeat(width)}`, ...body.map(pad)].join('\n');
}

/**
 * Markdown from an HTML fragment or page, without a DOM so it runs anywhere: headings, emphasis, links,
 * lists, tables, code and quotes survive; scripts, styles, inline styles and embedded pictures do not.
 * A picture whose address is a `data:` URI becomes `[image: alt]` because the bytes are attached separately.
 */
export function htmlToMarkdown(html: string): string {
  // Text goes to the innermost buffer; a link or table cell opens a new one so it can be wrapped when it closes.
  const buffers: string[] = [''];
  const links: string[] = [];
  const lists: ListFrame[] = [];
  const tables: TableFrame[] = [];
  let skipping: string | null = null;
  let skipDepth = 0;
  let pre = false;

  const write = (text: string) => {
    buffers[buffers.length - 1] += text;
  };
  const block = () => write('\n\n');
  // Emphasis and headings are written once their text is known, so empty ones can be dropped and the
  // spaces around a bold phrase kept outside its markers. A close that does not match the innermost open
  // one (broken markup) is ignored.
  const frames: { kind: string; depth: number }[] = [];
  const openFrame = (kind: string) => {
    frames.push({ kind, depth: buffers.length });
    buffers.push('');
  };
  const closeFrame = (kind: string): string | null => {
    const frame = frames[frames.length - 1];
    if (frame?.kind !== kind || frame.depth !== buffers.length - 1) return null;
    frames.pop();
    return buffers.pop() ?? '';
  };
  const closeMark = (kind: string, marker: string) => {
    const text = closeFrame(kind)?.replace(/\s*\n\s*/g, ' ');
    if (text === undefined || text === null) return;
    const inner = text.trim();
    if (inner === '') write(text === '' ? '' : ' ');
    else write(`${/^\s/.test(text) ? ' ' : ''}${marker}${inner}${marker}${/\s$/.test(text) ? ' ' : ''}`);
  };
  const line = () => write('\n');

  for (const match of html.matchAll(TOKEN)) {
    const [token, closing, rawName = '', rawAttributes = ''] = match;
    const name = rawName.toLowerCase();
    const isTag = rawName !== '';

    if (skipping !== null) {
      if (isTag && name === skipping) {
        skipDepth += closing ? -1 : 1;
        if (skipDepth === 0) skipping = null;
      }
      continue;
    }
    if (token.startsWith('<!--')) continue;

    if (!isTag) {
      const text = decodeEntities(token);
      if (pre) write(text);
      else {
        // Whitespace at the start of a line is markup indentation, not content.
        const atLineStart = /(?:^|\s)$/.test(buffers[buffers.length - 1] ?? '');
        const collapsed = text.replace(/\s+/g, ' ');
        write(atLineStart ? collapsed.trimStart() : collapsed);
      }
      continue;
    }

    if (!closing && SKIPPED.has(name)) {
      skipping = name;
      skipDepth = 1;
      continue;
    }
    const attrs = closing ? new Map<string, string>() : attributes(rawAttributes);

    if (!closing) {
      switch (name) {
        case 'br':
          write('\n');
          break;
        case 'hr':
          block();
          write('---');
          block();
          break;
        case 'img': {
          const src = attrs.get('src') ?? '';
          const alt = (attrs.get('alt') ?? '').trim();
          write(
            src === '' || src.startsWith('data:') || attrs.has('data-image')
              ? `[image${alt ? `: ${alt}` : ''}]`
              : `![${alt}](${src})`,
          );
          break;
        }
        case 'iframe':
        case 'embed':
        case 'video':
        case 'audio':
        case 'source': {
          const src = attrs.get('src');
          if (src) write(`[embedded: ${src}]`);
          break;
        }
        case 'a':
          links.push(attrs.get('href') ?? '');
          buffers.push('');
          break;
        case 'strong':
        case 'b':
          openFrame('strong');
          break;
        case 'em':
        case 'i':
          openFrame('em');
          break;
        case 'code':
          if (!pre) write('`');
          break;
        case 'pre':
          block();
          write('```\n');
          pre = true;
          break;
        case 'blockquote':
          block();
          buffers.push('');
          break;
        case 'ul':
        case 'ol':
          if (lists.length === 0) block();
          lists.push({ ordered: name === 'ol', count: 0 });
          break;
        case 'li': {
          const frame = lists[lists.length - 1];
          line();
          write('  '.repeat(Math.max(0, lists.length - 1)));
          if (frame?.ordered) write(`${++frame.count}. `);
          else write('- ');
          break;
        }
        case 'table':
          tables.push({ rows: [], row: [] });
          buffers.push('');
          break;
        case 'td':
        case 'th':
          buffers.push('');
          break;
        default:
          if (/^h[1-6]$/.test(name)) openFrame(name);
          else if (BLOCKS.has(name)) block();
      }
      continue;
    }

    switch (name) {
      case 'a': {
        const text = (buffers.pop() ?? '').trim();
        const href = links.pop() ?? '';
        write(href === '' || text === '' ? text : `[${text}](${href})`);
        break;
      }
      case 'strong':
      case 'b':
        closeMark('strong', '**');
        break;
      case 'em':
      case 'i':
        closeMark('em', '*');
        break;
      case 'code':
        if (!pre) write('`');
        break;
      case 'pre':
        pre = false;
        write('\n```');
        block();
        break;
      case 'blockquote': {
        const inner = tidyBlocks(buffers.pop() ?? '');
        write(
          inner
            .split('\n')
            .map((l) => (l === '' ? '>' : `> ${l}`))
            .join('\n'),
        );
        block();
        break;
      }
      case 'ul':
      case 'ol':
        lists.pop();
        if (lists.length === 0) block();
        break;
      case 'li':
        break;
      case 'td':
      case 'th': {
        const text = cell(buffers.pop() ?? '');
        tables[tables.length - 1]?.row.push(text);
        break;
      }
      case 'tr': {
        const table = tables[tables.length - 1];
        if (table && table.row.length > 0) table.rows.push(table.row);
        if (table) table.row = [];
        break;
      }
      case 'table': {
        const table = tables.pop();
        buffers.pop();
        block();
        if (table) write(renderTable(table.rows));
        block();
        break;
      }
      default:
        if (/^h[1-6]$/.test(name)) {
          const text = closeFrame(name)?.replace(/\s+/g, ' ').trim();
          // An empty heading is editor padding, not content.
          if (text) {
            block();
            write(`${'#'.repeat(Number(name[1]))} ${text}`);
          }
          block();
        } else if (BLOCKS.has(name) || name === 'p') block();
    }
  }
  return tidyBlocks(buffers.join(''));
}

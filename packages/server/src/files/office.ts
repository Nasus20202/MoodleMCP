import { cellText, markdownTable } from './table.ts';
import { decodeEntities, tidy } from './text.ts';
import { unzipText } from './zip.ts';

const slideNumber = (name: string) => Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);

/** A stretch of text with one set of character formatting, as Word stores it: a `<w:r>`. */
interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
}

/** Whether a property such as `<w:b/>` is switched on (`w:val="0"` or `"false"` switches it off). */
const flag = (properties: string, name: string) => {
  const tag = new RegExp(`<w:${name}\\b[^>]*>`).exec(properties)?.[0];
  return tag !== undefined && !/w:val="(?:0|false|off)"/.test(tag);
};

/** What goes inside a run: text, tabs and line breaks. Field codes (`w:instrText`) are not text. */
const RUN_CONTENT = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g;

function runsOf(paragraph: string): Run[] {
  const runs: Run[] = [];
  for (const [, body = ''] of paragraph.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
    const properties = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(body)?.[1] ?? '';
    const text = [...body.matchAll(RUN_CONTENT)]
      .map((m) =>
        m[0].startsWith('<w:tab') ? '\t' : m[0].startsWith('<w:br') ? '\n' : decodeEntities(m[1] ?? ''),
      )
      .join('');
    if (text !== '') runs.push({ text, bold: flag(properties, 'b'), italic: flag(properties, 'i') });
  }
  return runs;
}

/** Runs with the same formatting joined, so `**a****b**` never happens; spaces stay outside the markers. */
function inlineText(runs: Run[], formatted: boolean): string {
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last?.bold === run.bold && last.italic === run.italic) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged
    .map(({ text, bold, italic }) => {
      const inner = text.trim();
      const marker =
        !formatted || inner === '' ? '' : bold && italic ? '***' : bold ? '**' : italic ? '*' : '';
      if (marker === '') return text;
      return `${/^\s/.test(text) ? ' ' : ''}${marker}${inner}${marker}${/\s$/.test(text) ? ' ' : ''}`;
    })
    .join('');
}

interface Block {
  kind: 'paragraph' | 'heading' | 'list' | 'table';
  text: string;
}

/** The style name of a paragraph says whether it is a heading (`Heading2`, `Title`) or a numbered list. */
function paragraphBlock(xml: string): Block | 'blank' {
  const properties = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(xml)?.[1] ?? '';
  const style = /<w:pStyle\b[^>]*w:val="([^"]*)"/.exec(properties)?.[1] ?? '';
  const level = /^heading\s*([1-6])$/i.exec(style)?.[1] ?? (/^title$/i.test(style) ? '1' : undefined);
  const runs = runsOf(xml);
  if (level !== undefined) {
    const text = inlineText(runs, false).replace(/\s+/g, ' ').trim();
    return text === '' ? 'blank' : { kind: 'heading', text: `${'#'.repeat(Number(level))} ${text}` };
  }
  const text = inlineText(runs, true)
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (text === '') return 'blank';
  if (properties.includes('<w:numPr>') || /^list/i.test(style)) {
    const depth = Number(/<w:ilvl\b[^>]*w:val="(\d+)"/.exec(properties)?.[1] ?? 0);
    const marker = /number/i.test(style) ? '1.' : '-';
    return { kind: 'list', text: `${'  '.repeat(Math.min(depth, 6))}${marker} ${text.replace(/\n/g, ' ')}` };
  }
  return { kind: 'paragraph', text };
}

function tableBlock(xml: string): Block {
  const rows = [...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((row) =>
    [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cell) =>
      cellText(
        [...cell[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => inlineText(runsOf(p[0]), false)).join(' '),
      ),
    ),
  );
  return { kind: 'table', text: markdownTable(rows) };
}

/**
 * Markdown of a .docx: paragraphs in document order, headings (from their style), bullet and numbered list
 * items, bold and italic, and tables as pipe tables. Plain paragraphs follow each other on consecutive lines.
 */
export function docxText(bytes: Uint8Array): string {
  const xml = unzipText(bytes, (name) => name === 'word/document.xml').get('word/document.xml') ?? '';
  const blocks: (Block | 'blank')[] = [
    ...xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g),
  ].map(([match]) => (match.startsWith('<w:tbl') ? tableBlock(match) : paragraphBlock(match)));
  let out = '';
  let previous: Block | undefined;
  let gap = false;
  for (const block of blocks) {
    if (block === 'blank') {
      gap = true;
      continue;
    }
    // Plain paragraphs and list items follow each other directly; headings and tables get a blank line.
    const tight = !gap && previous?.kind === block.kind && block.kind !== 'heading' && block.kind !== 'table';
    out += out === '' ? block.text : `${tight ? '\n' : '\n\n'}${block.text}`;
    previous = block;
    gap = false;
  }
  return out.trim();
}

/** Text of a .pptx: each slide's text, then its speaker notes, under a slide heading. */
export function pptxText(bytes: Uint8Array): { text: string; slides: number } {
  const files = unzipText(bytes, (name) => /^ppt\/(slides|notesSlides)\/\w+\.xml$/.test(name));
  const textOf = (xml: string) =>
    tidy(
      decodeEntities(
        xml
          .replace(/<\/a:p>/g, '\n')
          .replace(/<(?!a:t\b)[^>]+>/g, '')
          .replace(/<a:t\b[^>]*>/g, ''),
      ),
    );

  const slides = [...files.keys()]
    .filter((n) => n.startsWith('ppt/slides/'))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const parts = slides.map((name) => {
    const number = slideNumber(name);
    const notes = files.get(`ppt/notesSlides/notesSlide${number}.xml`);
    const body = textOf(files.get(name) ?? '');
    const notesText = notes ? textOf(notes) : '';
    return `--- Slide ${number} ---\n${body}${notesText ? `\n[Notes] ${notesText}` : ''}`;
  });
  return { text: parts.join('\n\n'), slides: slides.length };
}

import { decodeEntities, tidy } from './text.ts';
import { unzipText } from './zip.ts';

const slideNumber = (name: string) => Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);

/** Text of a .docx: paragraphs in document order. */
export function docxText(bytes: Uint8Array): string {
  const xml = unzipText(bytes, (name) => name === 'word/document.xml').get('word/document.xml') ?? '';
  return tidy(
    decodeEntities(
      xml
        .replace(/<w:tab\b[^>]*\/>/g, '\t')
        .replace(/<w:br\b[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, ''),
    ),
  );
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

import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { MAX_PAGES_PER_CALL, readPdf } from './pdf.ts';

/** A PDF with one line of text per page, written by hand (pdf.js rebuilds the missing xref table). */
function pdfOf(pages: readonly string[]): Uint8Array {
  const font = 3 + pages.length * 2;
  const objects = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    `2 0 obj<</Type/Pages/Kids[${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}]/Count ${pages.length}>>endobj`,
    ...pages.flatMap((text, i) => {
      const stream = text ? `BT /F1 12 Tf 72 700 Td (${text}) Tj ET` : '';
      return [
        `${3 + i * 2} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${4 + i * 2} 0 R/Resources<</Font<</F1 ${font} 0 R>>>>>>endobj`,
        `${4 + i * 2} 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
      ];
    }),
    `${font} 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj`,
  ];
  return strToU8(['%PDF-1.4', ...objects, `trailer<</Root 1 0 R/Size ${font + 1}>>`, '%%EOF'].join('\n'));
}

// Each page reads "--- Page N ---\nPage N text" (26 characters for N < 10), pages joined by a blank line.
const PAGES = Array.from({ length: 5 }, (_, i) => `Page ${i + 1} text`);
const pdf = pdfOf(PAGES);

describe('readPdf', () => {
  it('reads the whole document when it fits, with each page headed', async () => {
    const chunk = await readPdf(pdf, { page: 1, offset: 0, maxChars: 10_000 });
    expect(chunk).toEqual({
      text: PAGES.map((text, i) => `--- Page ${i + 1} ---\n${text}`).join('\n\n'),
      pages: 5,
      firstPage: 1,
      lastPage: 5,
      next: null,
    });
  });

  it('pages through the document with the cursor it returns, losing and repeating nothing', async () => {
    const whole = (await readPdf(pdf, { page: 1, offset: 0, maxChars: 10_000 })).text;
    // Every page break and separator position gets cut at by some window size.
    for (const maxChars of [7, 26, 27, 28, 40]) {
      let cursor: { page: number; offset: number } | null = { page: 1, offset: 0 };
      let joined = '';
      for (let calls = 0; cursor && calls < 100; calls++) {
        const chunk = await readPdf(pdf, { ...cursor, maxChars });
        expect(chunk.text.length).toBeLessThanOrEqual(maxChars);
        joined += chunk.text;
        cursor = chunk.next;
      }
      expect(cursor).toBeNull();
      // Only the blank lines between pages are skipped when a window ends exactly at a page.
      expect(joined.replace(/\n/g, '')).toBe(whole.replace(/\n/g, ''));
    }
  });

  it('only extracts the pages a window needs', async () => {
    const chunk = await readPdf(pdf, { page: 2, offset: 0, maxChars: 30 });
    expect(chunk).toMatchObject({ firstPage: 2, lastPage: 3, next: { page: 3, offset: 2 } });
    expect(chunk.text).toBe('--- Page 2 ---\nPage 2 text\n\n--');
  });

  it('jumps straight to a page', async () => {
    const chunk = await readPdf(pdf, { page: 5, offset: 0, maxChars: 1000 });
    expect(chunk).toEqual({
      text: '--- Page 5 ---\nPage 5 text',
      pages: 5,
      firstPage: 5,
      lastPage: 5,
      next: null,
    });
  });

  it('says nothing is left past the last page', async () => {
    expect(await readPdf(pdf, { page: 9, offset: 0, maxChars: 1000 })).toEqual({
      text: '',
      pages: 5,
      next: null,
    });
  });

  it('keeps pages without a text layer, so scanned documents still page', async () => {
    const chunk = await readPdf(pdfOf(['', 'Two']), { page: 1, offset: 0, maxChars: 1000 });
    expect(chunk.text).toBe('--- Page 1 ---\n\n--- Page 2 ---\nTwo');
  });

  it('stops after a fixed number of pages even when they hold little text', async () => {
    const many = pdfOf(Array.from({ length: MAX_PAGES_PER_CALL + 5 }, () => ''));
    const chunk = await readPdf(many, { page: 1, offset: 0, maxChars: 100_000 });
    expect(chunk).toMatchObject({
      lastPage: MAX_PAGES_PER_CALL,
      next: { page: MAX_PAGES_PER_CALL + 1, offset: 0 },
    });
  });
});

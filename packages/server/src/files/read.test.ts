import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { DownloadedFile } from '../moodle/client.ts';
import { classify, pageText, readFile } from './read.ts';
import { htmlToText } from './text.ts';

const file = (filename: string, bytes: Uint8Array | string, mimeType = ''): DownloadedFile => ({
  filename,
  mimeType,
  bytes: typeof bytes === 'string' ? strToU8(bytes) : bytes,
  skipped: false,
});

/** A one-page PDF with a text layer, written by hand (pdf.js rebuilds the missing xref table). */
function tinyPdf(text: string): Uint8Array {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  return strToU8(
    [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
      `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
      'trailer<</Root 1 0 R/Size 6>>',
      '%%EOF',
    ].join('\n'),
  );
}

describe('readFile', () => {
  it('extracts text from a PDF', async () => {
    const result = await readFile(file('a.pdf', tinyPdf('Hello PDF'), 'application/pdf'));
    expect(result).toEqual({
      kind: 'pdf',
      chunk: { text: '--- Page 1 ---\nHello PDF', pages: 1, firstPage: 1, lastPage: 1, next: null },
    });
  });

  it('extracts paragraphs from a DOCX', async () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>First &amp; foremost</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second</w:t></w:r><w:tab/><w:r><w:t>line</w:t></w:r></w:p></w:body></w:document>';
    const docx = zipSync({ 'word/document.xml': strToU8(xml), 'word/styles.xml': strToU8('<ignored/>') });
    const result = await readFile(file('a.docx', docx));
    expect(result).toEqual({ kind: 'text', format: 'docx', text: 'First & foremost\nSecond line' });
  });

  it('extracts slides and speaker notes from a PPTX, in slide order', async () => {
    const slide = (text: string) => `<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`;
    const pptx = zipSync({
      'ppt/slides/slide10.xml': strToU8(slide('Ten')),
      'ppt/slides/slide2.xml': strToU8(slide('Two')),
      'ppt/slides/slide1.xml': strToU8(slide('One')),
      'ppt/notesSlides/notesSlide2.xml': strToU8(slide('say hi')),
    });
    const result = await readFile(file('a.pptx', pptx));
    expect(result).toEqual({
      kind: 'text',
      format: 'pptx',
      pages: 3,
      text: '--- Slide 1 ---\nOne\n\n--- Slide 2 ---\nTwo\n[Notes] say hi\n\n--- Slide 10 ---\nTen',
    });
  });

  it('extracts every sheet of an XLSX as tab-separated rows', async () => {
    const sheet = (rows: string) => `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(
        '<workbook><sheets><sheet name="Data &amp; more" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
      ),
      'xl/sharedStrings.xml': strToU8(
        '<sst><si><t>Name</t></si><si><r><t>Ann</t></r><r><t xml:space="preserve"> Lee</t></r></si></sst>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        sheet(
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Flag</t></is></c></row>' +
            '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>3.5</v></c><c r="C2" t="b"><v>1</v></c></row>',
        ),
      ),
      'xl/worksheets/sheet2.xml': strToU8(sheet('')),
    });
    const result = await readFile(file('a.xlsx', xlsx));
    expect(result).toEqual({
      kind: 'text',
      format: 'xlsx',
      pages: 2,
      text: '--- Sheet: Data & more ---\nName\t\tFlag\nAnn Lee\t3.5\tTRUE\n\n--- Sheet: Empty ---\n',
    });
  });

  it('refuses an archive that inflates beyond the limit', async () => {
    const bomb = zipSync({ 'word/document.xml': new Uint8Array(41 * 1024 * 1024) });
    await expect(readFile(file('bomb.docx', bomb))).rejects.toThrow(/too large/);
  });

  it('turns HTML into text', async () => {
    const result = await readFile(
      file('index.html', '<h1>Title</h1><p>One<br>two</p><script>x()</script>', 'text/html'),
    );
    expect(result).toEqual({ kind: 'text', format: 'html', text: 'Title\nOne\ntwo' });
  });

  it('reads plain text and code, by type or by extension', async () => {
    expect(await readFile(file('n.txt', 'zażółć', 'text/plain'))).toMatchObject({ text: 'zażółć' });
    expect(await readFile(file('main.py', 'print(1)', 'application/octet-stream'))).toMatchObject({
      kind: 'text',
      format: 'py',
    });
  });

  it('trusts the extension when the server only says octet-stream', async () => {
    const result = await readFile(file('a.pdf', tinyPdf('Octet'), 'application/octet-stream'));
    expect(result.kind).toBe('pdf');
  });

  it('returns small images as base64 and refuses large ones', async () => {
    const png = await readFile(file('a.png', new Uint8Array([137, 80, 78, 71]), 'image/png'));
    expect(png).toEqual({ kind: 'image', mimeType: 'image/png', base64: 'iVBORw==' });

    const big = await readFile(file('big.png', new Uint8Array(5 * 1024 * 1024), 'image/png'));
    expect(big.kind).toBe('unsupported');
  });

  it('encodes large images without overflowing the stack', async () => {
    const result = await readFile(file('a.jpg', new Uint8Array(3 * 1024 * 1024), 'image/jpeg'));
    expect(result.kind === 'image' && result.base64.length).toBe(4 * 1024 * 1024);
  });

  it('says what it cannot read', async () => {
    const result = await readFile(file('v.mp4', 'x', 'video/mp4'));
    expect(result.kind).toBe('unsupported');
    expect(result.kind === 'unsupported' && result.reason).toContain('video/mp4');
  });
});

describe('classify', () => {
  it.each([
    ['a.zip', 'application/zip', 'zip'],
    ['a.zip', 'application/octet-stream', 'zip'],
    ['a.kt', 'application/octet-stream', 'text'],
    ['a.svg', 'image/svg+xml', 'text'],
    ['a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
    ['a.zip', 'application/x-zip-compressed', 'zip'],
    ['a.7z', 'application/x-7z-compressed', null],
    ['a.avi', 'video/x-ms-wm', null],
    ['a.pdf', 'application/pdf', 'pdf'],
    ['a.PDF', '', 'pdf'],
    ['a.csv', 'text/csv', 'text'],
  ])('%s (%s) -> %s', (filename, mimeType, expected) => {
    expect(classify({ filename, mimeType })).toBe(expected);
  });
});

describe('pageText', () => {
  it('pages through text until nextOffset is null', () => {
    const text = 'abcdefghij';
    expect(pageText(text, { offset: 0, maxChars: 4 })).toEqual({
      slice: 'abcd',
      totalChars: 10,
      nextOffset: 4,
    });
    expect(pageText(text, { offset: 8, maxChars: 4 })).toEqual({
      slice: 'ij',
      totalChars: 10,
      nextOffset: null,
    });
    expect(pageText(text, { offset: 99, maxChars: 4 })).toEqual({
      slice: '',
      totalChars: 10,
      nextOffset: null,
    });
  });
});

describe('htmlToText', () => {
  it('decodes entities and keeps list structure', () => {
    expect(htmlToText('<ul><li>a &lt; b</li><li>&#322;&#x142;&nbsp;x</li></ul>')).toBe('- a < b\n- łł x');
  });
});

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { docxText } from './office.ts';

const docx = (body: string) =>
  zipSync({ 'word/document.xml': strToU8(`<w:document><w:body>${body}</w:body></w:document>`) });

const run = (text: string, props = '') =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (inner: string, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${inner}</w:p>`;
const style = (name: string) => `<w:pStyle w:val="${name}"/>`;

describe('docxText', () => {
  it('turns heading styles into Markdown headings, without bold inside them', () => {
    const body =
      para(run('Syllabus', '<w:b/>'), style('Heading1')) +
      para(run('Week 1'), style('Heading2')) +
      para(run('Sorting'));
    expect(docxText(docx(body))).toBe('# Syllabus\n\n## Week 1\n\nSorting');
  });

  it('keeps bold and italic, joining runs so markers are not doubled', () => {
    const body = para(
      run('Read ') + run('the ', '<w:b/>') + run('rules', '<w:b/>') + run(' now ') + run('please', '<w:i/>'),
    );
    expect(docxText(docx(body))).toBe('Read **the rules** now *please*');
  });

  it('ignores a property that is switched off', () => {
    expect(docxText(docx(para(run('plain', '<w:b w:val="0"/><w:i w:val="false"/>'))))).toBe('plain');
  });

  it('writes list items, indented by level, and numbered ones with 1.', () => {
    const numbered = (level: number, text: string) =>
      para(
        run(text),
        `${style('ListParagraph')}<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr>`,
      );
    const body = numbered(0, 'one') + numbered(1, 'nested') + para(run('first'), style('ListNumber'));
    expect(docxText(docx(body))).toBe('- one\n  - nested\n1. first');
  });

  it('writes a table as a pipe table with its first row as the header', () => {
    const cell = (text: string) => `<w:tc>${para(run(text))}</w:tc>`;
    const row = (...cells: string[]) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
    const body =
      para(run('Before')) +
      `<w:tbl>${row('Algorithm', 'Time')}${row('Quick | sort', 'O(n log n)')}</w:tbl>` +
      para(run('After'));
    expect(docxText(docx(body))).toBe(
      'Before\n\n| Algorithm | Time |\n| --- | --- |\n| Quick \\| sort | O(n log n) |\n\nAfter',
    );
  });

  it('keeps a blank paragraph as a paragraph break and plain paragraphs on consecutive lines', () => {
    const body = para(run('a')) + para(run('b')) + para('') + para(run('c'));
    expect(docxText(docx(body))).toBe('a\nb\n\nc');
  });

  it('reads text, tabs and breaks of a run but not field codes', () => {
    const body = para(
      '<w:r><w:t>x</w:t><w:tab/><w:t>y</w:t><w:br/><w:t>z</w:t></w:r><w:r><w:instrText>HYPERLINK "u"</w:instrText></w:r>',
    );
    expect(docxText(docx(body))).toBe('x\ty\nz');
  });

  it('decodes entities and returns nothing for a document without body text', () => {
    expect(docxText(docx(para(run('A &amp; B &lt; C'))))).toBe('A & B < C');
    expect(docxText(docx(''))).toBe('');
  });
});

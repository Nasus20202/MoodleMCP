import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { xlsxText } from './xlsx.ts';

/** A one-sheet workbook with the given styles and rows (cells already in XML). */
const workbook = (rows: string, styles = '') =>
  zipSync({
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/styles.xml': strToU8(`<styleSheet>${styles}</styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`),
  });

/** Style 0 general, 1 built-in date (14), 2 custom date-time, 3 custom number, 4 built-in time (21). */
const STYLES =
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/>' +
  '<numFmt numFmtId="165" formatCode="0.00&quot; m&quot;"/></numFmts>' +
  '<cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="21"/></cellXfs>';

const cell = (ref: string, style: number, value: number) => `<c r="${ref}" s="${style}"><v>${value}</v></c>`;

describe('xlsxText', () => {
  it('writes cells with a date format as dates, not serial numbers', () => {
    const rows = `<row r="1">${cell('A1', 1, 45292)}${cell('B1', 2, 45292.5)}${cell('C1', 4, 0.75)}</row>`;
    expect(xlsxText(workbook(rows, STYLES)).text).toBe(
      '--- Sheet: S ---\n| 2024-01-01 | 2024-01-01 12:00 | 18:00 |\n| --- | --- | --- |',
    );
  });

  it('leaves numbers alone, even with a custom format that has quoted letters', () => {
    const rows = `<row r="1">${cell('A1', 0, 45292)}${cell('B1', 3, 3.5)}</row>`;
    expect(xlsxText(workbook(rows, STYLES)).text).toBe('--- Sheet: S ---\n| 45292 | 3.5 |\n| --- | --- |');
  });

  it('shows the seconds of a time only when there are some', () => {
    const rows = `<row r="1">${cell('A1', 4, 0.5)}${cell('B1', 4, 0.50001157)}</row>`;
    expect(xlsxText(workbook(rows, STYLES)).text).toContain('| 12:00 | 12:00:01 |');
  });

  it('works without a styles part and pads rows to the widest one', () => {
    const rows =
      '<row r="1"><c r="A1" t="inlineStr"><is><t>a|b</t></is></c></row>' +
      '<row r="2"><c r="A2"><v>1</v></c><c r="C2"><v>3</v></c></row>';
    const files = {
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`),
    };
    expect(xlsxText(zipSync(files)).text).toBe(
      '--- Sheet: S ---\n| a\\|b |  |  |\n| --- | --- | --- |\n| 1 |  | 3 |',
    );
  });
});

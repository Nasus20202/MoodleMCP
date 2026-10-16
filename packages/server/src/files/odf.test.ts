import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { odfText, ODP, ODS, ODT } from './odf.ts';

const NS = 'xmlns:office="o" xmlns:text="t" xmlns:table="b" xmlns:draw="d"';
const odf = (body: string, mimetype = ODT) =>
  zipSync({
    mimetype: [strToU8(mimetype), { level: 0 }],
    'content.xml': strToU8(
      `<office:document-content ${NS}><office:body>${body}</office:body></office:document-content>`,
    ),
  });

describe('odfText', () => {
  it('reads the paragraphs of a text document, with tabs, breaks and spaces', () => {
    const bytes = odf(
      '<office:text><text:h>Title</text:h><text:p>a<text:tab/>b<text:line-break/>c<text:s text:c="3"/>d &amp; e</text:p></office:text>',
    );
    expect(odfText(bytes, ODT)).toEqual({ text: 'Title\na\tb\nc   d & e' });
  });

  it('gives each sheet of a spreadsheet as tab-separated rows', () => {
    const bytes = odf(
      '<office:spreadsheet><table:table table:name="Grades"><table:table-column/>' +
        '<table:table-row><table:table-cell><text:p>Ann</text:p></table:table-cell><table:table-cell/><table:table-cell><text:p>5</text:p></table:table-cell></table:table-row>' +
        '</table:table></office:spreadsheet>',
      ODS,
    );
    expect(odfText(bytes, ODS)).toEqual({ text: '--- Sheet 1: Grades ---\nAnn\t\t5', pages: 1 });
  });

  it('numbers the slides of a presentation', () => {
    const bytes = odf(
      '<office:presentation><draw:page draw:name="a"><text:p>One</text:p></draw:page><draw:page draw:name="b"><text:p>Two</text:p></draw:page></office:presentation>',
      ODP,
    );
    expect(odfText(bytes, ODP)).toEqual({ text: '--- Slide 1 ---\nOne\n\n--- Slide 2 ---\nTwo', pages: 2 });
  });
});

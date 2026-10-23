import { describe, expect, it } from 'vitest';

import { htmlToMarkdown } from './html-markdown.ts';

describe('htmlToMarkdown', () => {
  it('turns headings, emphasis and paragraphs into Markdown', () => {
    expect(htmlToMarkdown('<h2>Rules</h2><p>Read <strong>all</strong> of <em>it</em>.</p>')).toBe(
      '## Rules\n\nRead **all** of *it*.',
    );
  });

  it('keeps links and tells embedded pictures from linked ones', () => {
    const html =
      '<p><a href="https://x.test/a?b=1&amp;c=2">the <b>site</b></a> <img alt="Logo" src="https://x.test/l.png">' +
      '<img alt="Pasted" src="data:image/png;base64,AAAA"></p>';
    expect(htmlToMarkdown(html)).toBe(
      '[the **site**](https://x.test/a?b=1&c=2) ![Logo](https://x.test/l.png)[image: Pasted]',
    );
  });

  it('numbers ordered lists and indents nested ones', () => {
    expect(htmlToMarkdown('<ol><li>a<ul><li>b</li></ul></li><li> c </li></ol>')).toBe('1. a\n  - b\n2. c');
  });

  it('renders tables with a header row, escaping pipes', () => {
    const html = '<table><tr><th>A</th><th>B</th></tr><tr><td>1 | 2</td><td>x<br>y</td></tr></table>';
    expect(htmlToMarkdown(html)).toBe('| A | B |\n| --- | --- |\n| 1 \\| 2 | x y |');
  });

  it('fences code and quotes blocks', () => {
    expect(htmlToMarkdown('<pre>a  b\n c</pre><blockquote><p>q</p></blockquote>')).toBe(
      '```\na  b\n c\n```\n\n> q',
    );
  });

  it('drops scripts, styles, comments and inline styles but notes embedded media', () => {
    const html =
      '<style>p{}</style><!-- c --><p style="color:red">Hi<script>evil()</script></p>' +
      '<iframe src="https://video.test/v"></iframe>';
    expect(htmlToMarkdown(html)).toBe('Hi\n\n[embedded: https://video.test/v]');
  });

  it('decodes entities and survives broken markup', () => {
    expect(htmlToMarkdown('a &lt; b &amp; &#322;<p>unclosed <b>bold')).toBe('a < b & ł\n\nunclosed **bold');
  });
});

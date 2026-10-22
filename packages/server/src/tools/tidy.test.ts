import { describe, expect, it } from 'vitest';

import { pickSiteInfo, resolveMlang, stripHtmlBloat, tidyToJson } from './tidy.ts';

describe('stripHtmlBloat', () => {
  it('removes scripts, styles, svg and embedded images but keeps the text', () => {
    const html =
      '<p>Q1</p><script>M.str = {a:1}</script><style>p{}</style><img src="data:image/png;base64,AAAA" alt="x"><svg><g/></svg>';
    expect(stripHtmlBloat(html)).toBe('<p>Q1</p><img alt="x">');
  });
});

describe('resolveMlang', () => {
  const text = '{mlang pl}Algorytmy{mlang}{mlang en}Algorithms{mlang}';
  it('picks the requested language', () => {
    expect(resolveMlang(text, 'pl')).toBe('Algorytmy');
    expect(resolveMlang(text, 'en_us')).toBe('Algorithms');
  });
  it('prefers the exact locale over its base language', () => {
    const both = '{mlang en}Generic{mlang}{mlang en_us}American{mlang}';
    expect(resolveMlang(both, 'en_US')).toBe('American');
    expect(resolveMlang(both, 'en-us')).toBe('American');
    expect(resolveMlang(both, 'en_gb')).toBe('Generic');
  });
  it('falls back to other, then to the first part', () => {
    expect(resolveMlang('{mlang other}X{mlang}{mlang pl}Y{mlang}', 'de')).toBe('X');
    expect(resolveMlang(text, 'de')).toBe('Algorytmy');
  });
  it('keeps surrounding text and leaves plain text alone', () => {
    expect(resolveMlang('A {mlang en}B{mlang}{mlang pl}C{mlang} D', 'pl')).toBe('A C D');
    expect(resolveMlang('plain', 'pl')).toBe('plain');
  });
});

describe('tidyToJson', () => {
  const value = {
    id: 1,
    courseimage: 'data:image/png;base64,AAAA',
    name: '{mlang en}A{mlang}{mlang pl}B{mlang}',
    html: '<script>x</script>ok',
  };

  it('drops fields that are only a data URI, tidies nested strings and resolves the language', async () => {
    const json = await tidyToJson(value, () => Promise.resolve('pl'));
    expect(JSON.parse(json)).toEqual({ id: 1, name: 'B', html: 'ok' });
  });

  it('does not look up the language when there is no multi-language text', async () => {
    let asked = 0;
    const json = await tidyToJson([{ id: 1 }], () => {
      asked++;
      return Promise.resolve('en');
    });
    expect(json).toBe('[{"id":1}]');
    expect(asked).toBe(0);
  });
});

describe('pickSiteInfo', () => {
  it('keeps the identity fields and drops the private key and function list', () => {
    const out = pickSiteInfo({
      sitename: 'S',
      userid: 3,
      userprivateaccesskey: 'secret',
      functions: [{ name: 'f' }],
    });
    expect(out).toEqual({ sitename: 'S', userid: 3 });
  });
});

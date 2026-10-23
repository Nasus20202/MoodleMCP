import { describe, expect, it } from 'vitest';

import { pickSiteInfo, resolveMlang, slimMoodle, stripHtmlBloat, tidyToJson } from './tidy.ts';

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

describe('slimMoodle', () => {
  it('drops null, empty strings, empty objects and empty warnings, at any depth', () => {
    expect(
      slimMoodle({
        warnings: [],
        lang: null,
        intro: '',
        meta: {},
        course: { id: 1, warnings: [], nested: { a: null } },
        items: [{ id: 1, note: null }],
      }),
    ).toEqual({ course: { id: 1 }, items: [{ id: 1 }] });
  });

  it('keeps an empty list: it says there is nothing, which a missing key does not', () => {
    expect(slimMoodle({ quizzes: [], warnings: [], course: { glossaries: [] } })).toEqual({
      quizzes: [],
      course: { glossaries: [] },
    });
  });

  it('keeps zero, false and text: they are facts', () => {
    const value = { visible: 0, grade: 0, hidden: false, name: '0', list: [0, false, 'x'] };
    expect(slimMoodle(value)).toEqual(value);
  });

  it('keeps the places of list items, even empty ones', () => {
    expect(slimMoodle({ row: [null, 'a', {}, 'b'] })).toEqual({ row: [null, 'a', {}, 'b'] });
  });

  it('removes fields that only describe formatting, pictures, AI flags and icons', () => {
    expect(
      slimMoodle({
        id: 1,
        introformat: 1,
        summaryformat: 1,
        messageformat: 1,
        profileimageurl: 'u',
        profileimageurlsmall: 'u',
        enableaitools: true,
        enabledaiactions: 'x',
        legacyfiles: 0,
        legacyfileslast: 5,
        displayoptions: 'a:1:{}',
        modicon: 'u',
        format: 'topics',
        fileformat: 'x',
      }),
    ).toEqual({ id: 1, format: 'topics' });
  });

  it('leaves values that are not objects alone', () => {
    expect(slimMoodle('text')).toBe('text');
    expect(slimMoodle(7)).toBe(7);
    expect(slimMoodle(null)).toBeNull();
  });
});

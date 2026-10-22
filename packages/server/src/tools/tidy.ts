/**
 * Clean-up of Moodle's JSON before it reaches the model. Moodle returns rendered HTML with inline scripts,
 * translation tables and base64 images that are useless to a model and can run to hundreds of kilobytes.
 */

/**
 * A whole element that carries no readable text, tag and content: `<script>…</script>`, and likewise
 * style, svg and noscript. `\1` closes with the same tag name that opened, `\b` stops `<scripts>` matching
 * `script`, and the lazy `[\s\S]*?` (any character, newlines included) ends at the first closing tag.
 */
const BLOCKS = /<(script|style|svg|noscript)\b[\s\S]*?<\/\1\s*>/gi;

/**
 * An attribute whose value is an embedded file, such as `src="data:image/png;base64,…"`. It removes the
 * whitespace before the attribute, the name, and the quoted value; `\1` is the opening quote, so the
 * match ends at the matching one and cannot run past the tag. The tag itself stays, so `<img alt="x">` keeps its alt text.
 */
const DATA_URI_ATTRIBUTE = /\s(?:src|href|srcset|poster)\s*=\s*(["'])data:[^"'<>]*\1/gi;

/** A whole string that is a data URI (`data:<type>/<subtype>;` or `,`), such as a course image as base64. */
const DATA_URI_TEXT = /^data:[\w.+-]+\/[\w.+-]+[;,]/;

/**
 * One language part of Moodle's multi-language filter, `{mlang pl}text{mlang}`. Group 1 is the language
 * (`pl`, `en_us`, or `other`, the part shown when no language matches), group 2 the text up to the next
 * closing `{mlang}`.
 */
const MLANG = /\{mlang\s+([a-z]{2,3}(?:_[a-z]+)?|other)\s*\}([\s\S]*?)\{mlang\}/gi;

/** Three or more line breaks in a row, which removing a script usually leaves behind. */
const BLANK_LINES = /\n{3,}/g;

/** Drops scripts, styles, inline SVG and embedded (data:) images from an HTML string. */
export function stripHtmlBloat(html: string): string {
  return html.replace(BLOCKS, '').replace(DATA_URI_ATTRIBUTE, '').replace(BLANK_LINES, '\n\n');
}

/**
 * Resolves Moodle's multi-language markup (`{mlang pl}…{mlang}{mlang en}…{mlang}`) to the part in `lang`,
 * preferring an exact locale (`en_us`) over its base language (`en`), falling back to `other`, then to the first part. Text outside any tag is kept.
 */
export function resolveMlang(text: string, lang: string): string {
  if (!text.includes('{mlang')) return text;
  const parts = [...text.matchAll(MLANG)].map((m) => ({
    lang: (m[1] ?? '').toLowerCase(),
    text: m[2] ?? '',
  }));
  const locale = lang.toLowerCase().replace('-', '_');
  const base = locale.split('_')[0] ?? locale;
  const chosen =
    parts.find((p) => p.lang === locale) ??
    parts.find((p) => p.lang === base) ??
    parts.find((p) => p.lang === 'other') ??
    parts[0];
  let first = true;
  return text.replace(MLANG, () => {
    const out = first ? (chosen?.text ?? '') : '';
    first = false;
    return out;
  });
}

/** Applies `fn` to every string of a JSON value, dropping fields that are nothing but an embedded image. */
function mapStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => !(typeof item === 'string' && DATA_URI_TEXT.test(item)))
        .map(([key, item]) => [key, mapStrings(item, fn)]),
    );
  }
  return value;
}

/**
 * Tidies a Moodle result and serialises it. `lang` is asked for only when the text holds multi-language
 * markup, because finding out the user's language costs a request.
 */
export async function tidyToJson(value: unknown, lang: () => Promise<string>): Promise<string> {
  const text = JSON.stringify(mapStrings(value, stripHtmlBloat));
  if (!text.includes('{mlang')) return text;
  const wanted = await lang();
  return JSON.stringify(mapStrings(JSON.parse(text), (t) => resolveMlang(t, wanted)));
}

/** The fields of `core_webservice_get_site_info` worth showing; it also holds a private key and ~480 function names. */
const SITE_INFO_FIELDS = [
  'sitename',
  'siteurl',
  'username',
  'firstname',
  'lastname',
  'fullname',
  'lang',
  'userid',
  'release',
  'version',
] as const;

export function pickSiteInfo(info: unknown): unknown {
  if (typeof info !== 'object' || info === null) return info;
  const source = info as Record<string, unknown>;
  return Object.fromEntries(SITE_INFO_FIELDS.filter((f) => f in source).map((f) => [f, source[f]]));
}

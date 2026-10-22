import type { AppConfig } from './config.ts';
import type { MarkdownConverter } from './files/markdown.ts';

/** A call the fake Moodle received. */
export interface RecordedCall {
  url: URL;
  headers: Headers;
  /** Form fields for REST calls, or the parsed JSON body for AJAX calls. */
  body: unknown;
}

/** Returns the JSON body to answer with, or a ready Response. */
type Responder = (call: RecordedCall) => unknown;

/**
 * A stand-in for Moodle's HTTP API. `respond` maps a call to a JSON body (or a ready Response).
 */
export function fakeMoodle(respond: Responder): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const raw = await request.text();
    const isForm = request.headers.get('Content-Type')?.includes('x-www-form-urlencoded');
    const call: RecordedCall = {
      url: new URL(request.url),
      headers: request.headers,
      body: isForm ? Object.fromEntries(new URLSearchParams(raw)) : raw ? JSON.parse(raw) : undefined,
    };
    calls.push(call);
    const out = respond(call);
    return out instanceof Response ? out : Response.json(out);
  };
  return { fetch: fetchImpl, calls };
}

export const TEST_SITE = 'https://moodle.example.edu/2025';

export const testConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  moodleUrl: TEST_SITE,
  allowedHosts: [],
  allowInsecureSites: false,
  logLevel: 'error',
  ...overrides,
});

/** A file `toMarkdown` was asked to convert, and the options it was given. */
export interface ConversionCall {
  name: string;
  type: string;
  text: string;
  options: ConversionRequestOptions | undefined;
}

/**
 * A stand-in for Workers AI's `toMarkdown`. `respond` maps a file to its Markdown, or to an Error to report a
 * failed conversion the way Workers AI does (a result with format "error").
 */
export function fakeMarkdown(respond: (call: ConversionCall) => string | Error = (c) => `# ${c.name}`): {
  converter: MarkdownConverter;
  calls: ConversionCall[];
} {
  const calls: ConversionCall[] = [];
  const converter: MarkdownConverter = {
    async toMarkdown(file, options) {
      const call = { name: file.name, type: file.blob.type, text: await file.blob.text(), options };
      calls.push(call);
      const out = respond(call);
      const common = { id: '1', name: file.name, mimeType: file.blob.type };
      return out instanceof Error
        ? { ...common, format: 'error', error: out.message }
        : { ...common, format: 'markdown', tokens: Math.ceil(out.length / 4), data: out };
    },
  };
  return { converter, calls };
}

/** A one-page PDF with a text layer, written by hand (pdf.js rebuilds the missing xref table). */
export function tinyPdf(text: string): Uint8Array {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  return new TextEncoder().encode(
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

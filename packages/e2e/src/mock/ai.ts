import { strFromU8, unzipSync } from 'fflate';

/**
 * The Worker's `AI` binding in the e2e tests: a Worker exposing `toMarkdown` over RPC, as the real binding
 * does, that hands each file to `MockAi.handle` in Node through the `CONVERTER` service binding.
 */
export const AI_WORKER_SCRIPT = `
import { WorkerEntrypoint } from 'cloudflare:workers';

export class Ai extends WorkerEntrypoint {
  async toMarkdown(file, options) {
    const response = await this.env.CONVERTER.fetch('http://ai.mock/tomarkdown', {
      method: 'POST',
      body: file.blob,
      headers: {
        'X-Name': encodeURIComponent(file.name),
        'X-Type': file.blob.type,
        'X-Options': JSON.stringify(options ?? {}),
      },
    });
    return response.json();
  }
}

export default { fetch: () => new Response('Not found', { status: 404 }) };
`;

/** One file the Worker asked Workers AI to convert. */
export interface ConversionRequest {
  name: string;
  type: string;
  bytes: Uint8Array;
  options: {
    conversionOptions?: {
      pdf?: { metadata?: boolean; images?: { convert?: boolean } };
      docx?: { images?: { convert?: boolean } };
    };
  };
}

type Converter = (file: ConversionRequest) => string;

const tagsToText = (xml: string) =>
  xml
    .replace(/<\/(w:p|p|h\d|li)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();

/** Rough stand-ins for what `toMarkdown` does to each type the fixtures use. */
const CONVERTERS: Record<string, Converter> = {
  'application/pdf': ({ bytes, options }) => {
    const text = [...strFromU8(bytes).matchAll(/\((.*?)\)\s*Tj/g)].map((m) => m[1]).join('\n');
    // Workers AI adds the document's metadata unless asked not to.
    const metadata =
      options.conversionOptions?.pdf?.metadata === false ? '' : '## Metadata\n- PDFFormatVersion=1.4\n\n';
    return `${metadata}## Contents\n### Page 1\n${text}`;
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ({ bytes }) => {
    const xml = unzipSync(bytes)['word/document.xml'];
    return xml ? tagsToText(strFromU8(xml)) : '';
  },
  'text/html': ({ bytes }) => tagsToText(strFromU8(bytes)),
  'image/png': ({ bytes }) => `A small image of ${bytes.length} bytes, showing a diagram.`,
};

/**
 * A stand-in for Workers AI's document conversion. It answers the way the real service does: a result per
 * file, with format "error" (not an exception) for files it cannot convert.
 */
export class MockAi {
  readonly calls: ConversionRequest[] = [];
  /** When set, every conversion fails with this message, as when the daily allowance is spent. */
  failure: string | undefined;

  reset(): void {
    this.calls.length = 0;
    this.failure = undefined;
  }

  /** Pass this as the `CONVERTER` service of the AI worker. */
  readonly handle = async (request: Request): Promise<Response> => {
    const name = decodeURIComponent(request.headers.get('X-Name') ?? '');
    const type = request.headers.get('X-Type') ?? '';
    const file: ConversionRequest = {
      name,
      type,
      bytes: new Uint8Array(await request.arrayBuffer()),
      options: JSON.parse(request.headers.get('X-Options') ?? '{}') as ConversionRequest['options'],
    };
    this.calls.push(file);

    const common = { id: String(this.calls.length), name, mimeType: type };
    const convert = CONVERTERS[type];
    if (this.failure !== undefined) return Response.json({ ...common, format: 'error', error: this.failure });
    if (!convert)
      return Response.json({ ...common, format: 'error', error: `Unsupported file type: ${type}` });
    const data = convert(file);
    return Response.json({ ...common, format: 'markdown', tokens: Math.ceil(data.length / 4), data });
  };
}

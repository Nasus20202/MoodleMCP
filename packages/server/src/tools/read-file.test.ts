import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { callTool, setup } from '../app-test-utils.ts';
import { fakeMarkdown, type RecordedCall, TEST_SITE, testConfig, tinyPdf } from '../test-utils.ts';
import { ToolName } from './names.ts';

describe('read_file', () => {
  const FILE = `${TEST_SITE}/webservice/pluginfile.php/1/mod_resource/content/1/notes.txt`;
  const serve =
    (body: BodyInit, type = 'text/plain') =>
    (call: RecordedCall) =>
      call.url.pathname.includes('pluginfile.php')
        ? new Response(body, { headers: { 'Content-Type': type } })
        : {};

  const readFile = async (respond: (call: RecordedCall) => unknown, args: Record<string, unknown> = {}) => {
    const { app, moodle, logs } = setup(respond);
    const { body } = await callTool(app, ToolName.ReadFile, { file_url: FILE, ...args });
    const text = body.result?.content?.[0]?.text ?? '';
    return { body, moodle, logs, text, json: () => JSON.parse(text) as Record<string, unknown> };
  };

  it('returns the text of a file, downloaded with the caller token', async () => {
    const { json, moodle } = await readFile(serve('hello world'));
    expect(json()).toMatchObject({
      filename: 'notes.txt',
      readable: true,
      text: 'hello world',
      total_chars: 11,
      next_offset: null,
    });
    expect(moodle.calls[0]?.url.searchParams.get('token')).toBe('user-token');
  });

  it('pages through long files with offset and max_chars', async () => {
    const text = 'x'.repeat(1500) + 'y'.repeat(500);
    const first = (await readFile(serve(text), { max_chars: 1000 })).json();
    expect(first).toMatchObject({ next_offset: 1000, total_chars: 2000 });

    const last = (await readFile(serve(text), { offset: 1500, max_chars: 1000 })).json();
    expect(last).toMatchObject({ next_offset: null, text: 'y'.repeat(500) });
  });

  it('returns an image as an image block', async () => {
    const { body } = await readFile(serve(new Uint8Array([137, 80, 78, 71]), 'image/png'));
    expect(body.result?.content).toEqual([
      { type: 'image', data: 'iVBORw==', mimeType: 'image/png' },
      expect.objectContaining({ type: 'text' }),
    ]);
  });

  it('explains files it cannot read instead of failing', async () => {
    const { json } = await readFile(serve('x', 'video/mp4'));
    expect(json().readable).toBe(false);
    expect(json().note).toContain('video/mp4');
  });

  it('returns the whole file as base64 in resource mode, whatever its type', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { body, moodle } = await readFile(serve(bytes, 'video/mp4'), { mode: 'resource' });
    const [resource, info] = body.result?.content ?? [];
    expect(resource).toEqual({
      type: 'resource',
      resource: { uri: 'moodle-file:///notes.txt', mimeType: 'video/mp4', blob: 'AQID' },
    });
    expect(JSON.parse(info?.text ?? '{}')).toMatchObject({ filename: 'notes.txt', size_bytes: 3 });
    expect(moodle.calls).toHaveLength(1);
  });

  describe('ZIP archives', () => {
    const inner = zipSync({ 'deep.txt': strToU8('deep') });
    const archive = () =>
      zipSync({
        'src/': new Uint8Array(),
        'src/Main.kt': strToU8('fun main() = println("hi")'),
        'notes.txt': strToU8('zip notes'),
        'clip.mp4': new Uint8Array([0, 0, 0, 24]),
        'inner.zip': inner,
      });

    it('lists the files of an archive and says which can be read', async () => {
      const { json, moodle } = await readFile(serve(archive(), 'application/zip'));
      expect(json()).toMatchObject({
        filename: 'notes.txt',
        readable: true,
        format: 'zip',
        entry_count: 4,
      });
      expect(json().entries).toEqual([
        { path: 'src/Main.kt', size_bytes: 26, type: null, readable: 'unknown' },
        { path: 'notes.txt', size_bytes: 9, type: null, readable: 'unknown' },
        { path: 'clip.mp4', size_bytes: 4, type: null, readable: 'unknown' },
        { path: 'inner.zip', size_bytes: inner.length, type: 'application/zip', readable: false },
      ]);
      expect(moodle.calls).toHaveLength(1);
    });

    it('says when paging arguments are given for a listing', async () => {
      const { json } = await readFile(serve(archive(), 'application/zip'), { max_chars: 2000 });
      expect(String(json().note)).toContain('do not apply to a listing');
      const plain = await readFile(serve(archive(), 'application/zip'));
      expect(String(plain.json().note)).not.toContain('do not apply');
    });

    it('reads one entry like a file of its own, with paging', async () => {
      const { json } = await readFile(serve(archive(), 'application/zip'), { entry: 'src/Main.kt' });
      expect(json()).toMatchObject({
        filename: 'Main.kt',
        readable: true,
        format: 'kt',
        text: 'fun main() = println("hi")',
        next_offset: null,
      });
      expect(json().note).toContain('src/Main.kt');
    });

    it('explains instead of failing for a missing, unreadable or nested entry', async () => {
      const respond = serve(archive(), 'application/zip');
      const missing = (await readFile(respond, { entry: 'nope.txt' })).json();
      expect(missing).toMatchObject({ readable: false });
      expect(missing.note).toContain('no entry');

      const media = (await readFile(respond, { entry: 'clip.mp4' })).json();
      expect(media).toMatchObject({
        filename: 'clip.mp4',
        mime_type: 'application/octet-stream',
        size_bytes: 4,
        readable: false,
      });

      const nested = (await readFile(respond, { entry: 'inner.zip' })).json();
      expect(nested).toMatchObject({ readable: false });
      expect(nested.note).toContain('inside an archive');
    });

    it('reports a corrupt archive without crashing', async () => {
      const { json, body } = await readFile(serve('PK not really', 'application/zip'));
      expect(body.result?.isError).toBeUndefined();
      expect(json()).toMatchObject({ readable: false });
    });

    it('says when entry is given for a file that is not an archive', async () => {
      const { json } = await readFile(serve('plain'), { entry: 'a.txt' });
      expect(json()).toMatchObject({ text: 'plain' });
      expect(json().note).toContain('only used for ZIP');
    });

    it('never logs entry names or contents', async () => {
      const { logs } = await readFile(serve(archive(), 'application/zip'), { entry: 'src/Main.kt' });
      const all = logs.join('\n');
      expect(all).not.toMatch(/Main\.kt|notes\.txt|println|zip notes/);
    });
  });

  it('limits resource files to 20 MB', async () => {
    const { body } = await readFile(serve(new Uint8Array(21 * 1024 * 1024)), { mode: 'resource' });
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain('too large');
  });

  it('refuses URLs outside the site without contacting anything', async () => {
    const { app, moodle } = setup();
    const { body } = await callTool(app, ToolName.ReadFile, {
      file_url: 'https://evil.example.org/2025/webservice/pluginfile.php/1/a.txt',
    });
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain('invalidfileurl');
    expect(moodle.calls).toHaveLength(0);
  });

  it('reports a missing file as a tool error', async () => {
    const { body } = await readFile(() => ({ error: 'File not found', errorcode: 'filenotfound' }));
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain('filenotfound');
  });

  const logLines = (logs: string[]) => logs.map((l) => JSON.parse(l) as Record<string, unknown>);

  it('logs what it parsed, without the file name or contents', async () => {
    const { logs } = await readFile(serve('hello world'));
    const line = logLines(logs).find((l) => l.msg === 'file parsed');
    expect(line).toMatchObject({
      level: 'info',
      format: 'text',
      mime: 'text/plain',
      bytes: 11,
      chars: 11,
      truncated: false,
    });
    expect(typeof line?.ms).toBe('number');
    expect(logs.join('\n')).not.toContain('hello world');
  });

  it('logs external downloads', async () => {
    const { logs } = await readFile(serve('abc'));
    expect(
      logLines(logs).find((l) => l.msg === 'moodle download' || String(l.msg).startsWith('moodle download ')),
    ).toMatchObject({
      ok: true,
      skipped: false,
      mime: 'text/plain',
      bytes: 3,
    });
  });

  it('reports a file that cannot be parsed instead of failing, and logs a warning', async () => {
    const { json, logs, body } = await readFile(serve('not a pdf', 'application/pdf'));
    expect(body.result?.isError).toBeUndefined();
    expect(json()).toMatchObject({ readable: false, filename: 'notes.txt' });
    expect(String(json().note)).toContain('could not be parsed');
    expect(logLines(logs).find((l) => l.msg === 'file parse failed')).toMatchObject({
      level: 'warn',
      format: 'pdf',
      mime: 'application/pdf',
      bytes: 9,
    });
  });

  it('logs the pages it read from a PDF', async () => {
    const { json, logs } = await readFile(serve(tinyPdf('Hello PDF'), 'application/pdf'));
    expect(json()).toMatchObject({ format: 'pdf', mode: 'extract', first_page: 1, next_page: null });
    const line = logLines(logs).find((l) => l.msg === 'file parsed');
    expect(line).toMatchObject({
      level: 'info',
      format: 'pdf',
      mode: 'extract',
      mime: 'application/pdf',
      pages: 1,
      pagesRead: 1,
      truncated: false,
    });
    expect(typeof line?.ms).toBe('number');
    expect(logs.join('\n')).not.toContain('Hello PDF');
  });

  it('logs an image it returns', async () => {
    const { logs } = await readFile(serve(new Uint8Array([137, 80, 78, 71]), 'image/png'));
    expect(logLines(logs).find((l) => l.msg === 'file parsed')).toMatchObject({
      format: 'image',
      mode: 'extract',
      mime: 'image/png',
      bytes: 4,
    });
  });

  it('logs an image too large to return as not readable', async () => {
    const { json, logs } = await readFile(serve(new Uint8Array(5 * 1024 * 1024), 'image/png'));
    expect(json()).toMatchObject({ readable: false });
    expect(String(json().note)).toContain('4 MB');
    expect(logLines(logs).find((l) => l.msg === 'file not readable')).toMatchObject({
      mime: 'image/png',
      reason: 'too large to return',
    });
  });

  it('logs an archive it cannot open', async () => {
    const { logs } = await readFile(serve('PK not really', 'application/zip'));
    expect(logLines(logs).find((l) => l.msg === 'file parse failed')).toMatchObject({
      level: 'warn',
      format: 'zip',
      mime: 'application/zip',
      bytes: 13,
    });
  });

  it('logs files it declines to download', async () => {
    const { logs } = await readFile(serve('x', 'video/mp4'));
    expect(logLines(logs).find((l) => l.msg === 'file not readable')).toMatchObject({ mime: 'video/mp4' });
  });

  it('never logs the token or the file URL', async () => {
    const { logs } = await readFile(serve('hello'));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toMatch(/user-token|notes\.txt|pluginfile/);
  });

  describe('markdown mode', () => {
    const readWith = async (
      respond: (call: RecordedCall) => unknown,
      args: Record<string, unknown> = {},
      markdown = fakeMarkdown(),
    ) => {
      const { app, logs } = setup(respond, testConfig(), { markdown: markdown.converter });
      const { body } = await callTool(app, ToolName.ReadFile, { file_url: FILE, ...args });
      const text = body.result?.content?.at(-1)?.text ?? '';
      return { body, logs, calls: markdown.calls, json: () => JSON.parse(text) as Record<string, unknown> };
    };

    it.each([
      ['application/pdf', 'pdf'],
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
      ['text/html', 'html'],
    ])('converts %s by default, without converting embedded images', async (type, format) => {
      const { json, calls } = await readWith(serve('file body', type));
      expect(json()).toMatchObject({ format, mode: 'markdown', text: '# notes.txt', next_offset: null });
      expect(calls).toEqual([
        {
          name: 'notes.txt',
          type,
          text: 'file body',
          options: {
            conversionOptions: {
              pdf: { metadata: false, images: { convert: false } },
              docx: { images: { convert: false } },
              html: { images: { convert: false, convertOGImage: false } },
            },
          },
        },
      ]);
    });

    it('logs the conversion with its token count, but not the file', async () => {
      const { logs } = await readWith(serve('file body', 'application/pdf'));
      expect(logLines(logs).find((l) => l.msg === 'file converted')).toMatchObject({
        level: 'info',
        format: 'pdf',
        mode: 'markdown',
        bytes: 9,
        chars: 11,
        tokens: 3,
      });
      expect(logs.join('\n')).not.toMatch(/notes\.txt|file body/);
    });

    it('uses the type from the extension when Moodle says octet-stream', async () => {
      const file = `${TEST_SITE}/webservice/pluginfile.php/1/mod_resource/content/1/slides.pdf`;
      const { json, calls } = await readWith(serve('x', 'application/octet-stream'), { file_url: file });
      expect(json()).toMatchObject({ mode: 'markdown' });
      expect(calls[0]).toMatchObject({ name: 'slides.pdf', type: 'application/pdf' });
    });

    it('pages through long Markdown by characters', async () => {
      const markdown = fakeMarkdown(() => 'm'.repeat(2500));
      const { json } = await readWith(
        serve('x', 'application/pdf'),
        { offset: 1000, max_chars: 1000 },
        markdown,
      );
      expect(json()).toMatchObject({
        total_chars: 2500,
        offset: 1000,
        next_offset: 2000,
        text: 'm'.repeat(1000),
      });
    });

    it('keeps extracting images, presentations and plain text unless markdown is asked for', async () => {
      const image = await readWith(serve(new Uint8Array([137, 80, 78, 71]), 'image/png'));
      expect(image.body.result?.content?.[0]).toMatchObject({ type: 'image' });
      const text = await readWith(serve('plain words'));
      expect(text.json()).toMatchObject({ mode: 'extract', text: 'plain words' });
      expect([...image.calls, ...text.calls]).toEqual([]);
    });

    it('describes an image when markdown is asked for', async () => {
      const markdown = fakeMarkdown(() => 'A diagram of a binary tree.');
      const { json, calls } = await readWith(
        serve(new Uint8Array([1, 2]), 'image/png'),
        { mode: 'markdown' },
        markdown,
      );
      expect(json()).toMatchObject({
        format: 'image',
        mode: 'markdown',
        text: 'A diagram of a binary tree.',
      });
      expect(calls).toHaveLength(1);
    });

    it('extracts PDFs when asked to, or when a page is given', async () => {
      const extracted = await readWith(serve('not a pdf', 'application/pdf'), { mode: 'extract' });
      const paged = await readWith(serve('not a pdf', 'application/pdf'), { page: 2 });
      expect([...extracted.calls, ...paged.calls]).toEqual([]);
    });

    it('extracts with a note when markdown is asked for a type it cannot convert', async () => {
      const { json, calls } = await readWith(serve('plain words'), { mode: 'markdown' });
      expect(json()).toMatchObject({ mode: 'extract', text: 'plain words' });
      expect(String(json().note)).toContain('does not support this file type');
      expect(calls).toEqual([]);
    });

    it('extracts with a note when markdown is asked for but not set up', async () => {
      const { json } = await readFile(serve('<p>Hi</p>', 'text/html'), { mode: 'markdown' });
      expect(json()).toMatchObject({ mode: 'extract', text: 'Hi' });
      expect(String(json().note)).toContain('not set up');
    });

    it('falls back to extraction when the conversion fails, logging no details of the file', async () => {
      const markdown = fakeMarkdown(() => new Error('notes.txt: daily neuron limit exceeded'));
      const { json, logs } = await readWith(serve('<p>Hello</p>', 'text/html'), {}, markdown);
      expect(json()).toMatchObject({ mode: 'extract', text: 'Hello' });
      expect(String(json().note)).toContain('Markdown conversion failed');
      expect(logLines(logs).find((l) => l.msg === 'markdown conversion failed')).toMatchObject({
        level: 'warn',
        format: 'html',
        reason: 'quota',
        error: 'MarkdownConversionError',
      });
      expect(logs.join('\n')).not.toMatch(/notes\.txt|neuron/);
    });

    it.each([
      ['notes.txt: daily neuron limit exceeded', 'quota', 'allowance'],
      ['notes.txt: Unsupported file type', 'unsupported', 'cannot handle'],
      ['notes.txt: boom', 'failed', 'extracted instead'],
    ])(
      'says why the conversion failed (%s), without the converter message',
      async (message, reason, hint) => {
        const markdown = fakeMarkdown(() => new Error(message));
        const { json, logs } = await readWith(serve('<p>Hello</p>', 'text/html'), {}, markdown);
        expect(json()).toMatchObject({ mode: 'extract', text: 'Hello' });
        expect(String(json().note)).toContain(hint);
        expect(logLines(logs).find((l) => l.msg === 'markdown conversion failed')).toMatchObject({ reason });
        expect(logs.join('\n')).not.toMatch(/notes\.txt|neuron|boom|Unsupported/);
        expect(String(json().note)).not.toMatch(/notes\.txt|neuron|boom/);
      },
    );

    it('returns the image itself, with a note, when describing it fails', async () => {
      const markdown = fakeMarkdown(() => new Error('Unsupported file type'));
      const { body } = await readWith(
        serve(new Uint8Array([1, 2]), 'image/png'),
        { mode: 'markdown' },
        markdown,
      );
      expect(body.result?.content?.[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
      expect(String(body.result?.content?.at(-1)?.text)).toContain('Markdown conversion failed');
    });
  });
});

import { describe, expect, it } from 'vitest';

import { McpClient, textOf, type ToolResult } from './mcp.ts';
import { ALICE, BOB, FILE_URLS, OTHER_SITE_URL, PNG_BYTES, SITE_URL } from './mock/data.ts';
import { useWorld } from './world.ts';

const fileUrl = (name: string, id: number) =>
  `${SITE_URL}/webservice/pluginfile.php/${id}/mod_resource/content/1/${name}`;

interface FileText {
  filename: string;
  mime_type: string;
  readable: boolean;
  text: string;
  total_chars: number;
  next_offset: number | null;
  pages?: number;
  note?: string;
  size_bytes?: number;
}

describe('read_file against a mock Moodle file server', () => {
  const world = useWorld();
  const alice = () => McpClient.bearer(world.worker, ALICE.token);
  const read = async (file_url: string, extra: Record<string, unknown> = {}) => {
    const result = await alice().call('read_file', { file_url, ...extra });
    return { result, json: () => JSON.parse(result.content.at(-1)?.text ?? 'null') as FileText };
  };

  it('downloads with the caller’s token and returns the text', async () => {
    const { json } = await read(FILE_URLS.notes);
    expect(json()).toMatchObject({
      filename: 'notes.txt',
      mime_type: 'text/plain',
      text: 'Big-O notes: O(n log n) beats O(n^2).',
      next_offset: null,
    });
    const [download] = world.moodle.requests;
    expect(download).toMatchObject({ kind: 'file', method: 'GET', token: ALICE.token });
    expect(download?.userAgent).toMatch(/^MoodleMobile\//);
  });

  it('turns the plain pluginfile.php links found in HTML into web service downloads', async () => {
    const { json } = await read(FILE_URLS.notesPlain);
    expect(json().text).toContain('Big-O notes');
    expect(world.moodle.requests[0]?.url.pathname).toContain('/webservice/pluginfile.php/');
  });

  it('extracts the text layer of a PDF', async () => {
    const { json } = await read(FILE_URLS.slides);
    // No AI binding here, as under `wrangler dev --local`, so auto mode extracts the text itself.
    expect(json()).toMatchObject({
      filename: 'slides.pdf',
      mode: 'extract',
      pages: 1,
      next_page: null,
      next_offset: null,
    });
    expect(json().text).toBe('--- Page 1 ---\nLecture one slides');
  });

  it('says when a PDF page is past the end', async () => {
    const { json } = await read(FILE_URLS.slides, { page: 3 });
    expect(json()).toMatchObject({ pages: 1, text: '', next_page: null });
    expect(json().note).toContain('past the end');
  });

  it('keeps the headings and tables of a Word document', async () => {
    const { json } = await read(fileUrl('schedule.docx', 317));
    expect(json().text).toBe('# Schedule\n\n| Week | Topic |\n| --- | --- |\n| 1 | Sorting |');
  });

  it('extracts paragraphs from a Word document', async () => {
    const { json } = await read(fileUrl('syllabus.docx', 303));
    expect(json().text).toBe('Syllabus\nWeek 1: sorting');
  });

  it('extracts the text of a LibreOffice document', async () => {
    expect((await read(fileUrl('letter.odt', 315))).json()).toMatchObject({
      format: 'odf',
      text: 'Dear students',
    });
  });

  it('converts HTML to text and drops scripts', async () => {
    const { json } = await read(fileUrl('page.html', 306));
    expect(json().text).toContain('Welcome');
    expect(json().text).toContain('chapter 1');
    expect(json().text).not.toContain('alert');
  });

  it('pages through a long file with offset and max_chars', async () => {
    const url = fileUrl('long.txt', 308);
    const first = (await read(url, { max_chars: 2000 })).json();
    expect(first).toMatchObject({ total_chars: 5000, next_offset: 2000 });
    expect(first.text).toBe('a'.repeat(2000));

    const second = (await read(url, { offset: 2000, max_chars: 2000 })).json();
    expect(second.text).toBe('a'.repeat(500) + 'b'.repeat(1500));
    expect(second.next_offset).toBe(4000);

    const last = (await read(url, { offset: 4000, max_chars: 2000 })).json();
    expect(last).toMatchObject({ text: 'b'.repeat(1000), next_offset: null });
  });

  it('returns an image as an image block, base64 encoded', async () => {
    const { result } = await read(fileUrl('diagram.png', 304));
    expect(result.content[0]).toEqual({
      type: 'image',
      mimeType: 'image/png',
      data: Buffer.from(PNG_BYTES).toString('base64'),
    });
  });

  it('explains instead of failing when a file cannot be read as text', async () => {
    const { result, json } = await read(fileUrl('lecture.mp4', 305));
    expect(result.isError).toBeUndefined();
    expect(json()).toMatchObject({ readable: false, mime_type: 'video/mp4' });
    expect(json().note).toContain('video/mp4');
  });

  it('returns the unmodified file as an embedded resource in resource mode', async () => {
    const { result } = await read(fileUrl('lecture.mp4', 305), { mode: 'resource' });
    expect(result.content[0]?.resource).toEqual({
      uri: 'moodle-file:///lecture.mp4',
      mimeType: 'video/mp4',
      blob: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]).toString('base64'),
    });
    expect(JSON.parse(result.content[1]?.text ?? '{}')).toMatchObject({
      filename: 'lecture.mp4',
      size_bytes: 8,
    });
  });

  it('returns an image as an image block in resource mode', async () => {
    const { result } = await read(fileUrl('diagram.png', 304), { mode: 'resource' });
    expect(result.content[0]).toEqual({
      type: 'image',
      mimeType: 'image/png',
      data: Buffer.from(PNG_BYTES).toString('base64'),
    });
  });

  it('lists the files of a ZIP archive and reads one of them', async () => {
    const url = fileUrl('materials.zip', 310);
    const listing = (await read(url)).json() as unknown as {
      format: string;
      entry_count: number;
      entries: { path: string; readable: boolean | 'unknown' }[];
    };
    expect(listing).toMatchObject({ format: 'zip', entry_count: 3 });
    expect(listing.entries.map((e) => [e.path, e.readable])).toEqual([
      ['code/Sort.kt', 'unknown'],
      ['readme.txt', 'unknown'],
      ['clip.mp4', 'unknown'],
    ]);

    const entry = (await read(url, { entry: 'code/Sort.kt' })).json();
    expect(entry).toMatchObject({ filename: 'Sort.kt', readable: true, text: 'fun sort() = Unit' });

    const clip = (await read(url, { entry: 'clip.mp4' })).json();
    expect(clip).toMatchObject({ filename: 'clip.mp4', readable: false });
    expect(world.moodle.requests.every((r) => r.method === 'GET')).toBe(true);
  });

  it('tells what a file of unknown type is from its content', async () => {
    const text = (await read(fileUrl('Main.kt', 311))).json();
    expect(text).toMatchObject({ mime_type: 'text/plain', readable: true, text: 'fun main() = Unit' });

    const image = await read(fileUrl('picture', 312));
    expect(image.result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });

    const legacy = (await read(fileUrl('legacy.txt', 314), { mode: 'extract' })).json();
    expect(legacy.text).toBe('zażółć');
    expect(legacy.note).toContain('windows-1250');

    const binary = (await read(fileUrl('blob.dat', 313))).json();
    expect(binary).toMatchObject({ readable: false });
    expect(binary.note).toContain('Cannot extract text');
    expect(binary.note).toContain('mode resource');
  });

  it('keeps ZIP entry names and contents out of the logs', async () => {
    await read(fileUrl('materials.zip', 310), { entry: 'code/Sort.kt' });
    expect(await world.worker.rawLogs()).not.toMatch(/Sort\.kt|readme\.txt|fun sort|Lab materials/);
  });

  it('refuses resource files over 20 MB', async () => {
    const { result } = await read(fileUrl('huge.bin', 307), { mode: 'resource' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('too large');
  });

  describe('what it refuses', () => {
    const refused = async (url: string) => {
      const { result } = await read(url);
      expect(result.isError).toBe(true);
      return textOf(result);
    };

    it('reports a missing file with Moodle’s reason', async () => {
      expect(await refused(fileUrl('nope.txt', 999))).toContain('filenotfound');
    });

    it('reports a file of a course the user is not enrolled in', async () => {
      const result: ToolResult = await McpClient.bearer(world.worker, BOB.token).call('read_file', {
        file_url: FILE_URLS.notes,
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('requireloginerror');
    });

    it('never contacts a host other than the Moodle site, so the token cannot be sent elsewhere', async () => {
      for (const url of [
        'https://evil.example.org/2025/webservice/pluginfile.php/1/a.txt',
        `${OTHER_SITE_URL}/webservice/pluginfile.php/1/a.txt`,
        'http://moodle.example.edu/2025/webservice/pluginfile.php/1/a.txt',
        `https://attacker@moodle.example.edu.evil.example/2025/webservice/pluginfile.php/1/a.txt`,
      ]) {
        expect(await refused(url), url).toContain('invalidfileurl');
      }
      expect(world.moodle.requests).toHaveLength(0);
      expect(world.other.requests).toHaveLength(0);
      expect(world.network.stray).toEqual([]);
    });

    it('only serves the file server, not other pages of the site', async () => {
      expect(await refused(`${SITE_URL}/user/profile.php?id=1`)).toContain('invalidfileurl');
      expect(await refused(`${SITE_URL}/admin/index.php`)).toContain('invalidfileurl');
      expect(await refused('not a url')).toContain('invalidfileurl');
      expect(world.moodle.requests).toHaveLength(0);
    });

    it('does not follow redirects, which could forward the token', async () => {
      world.moodle.redirect(
        '/webservice/pluginfile.php/309/mod_resource/content/1/redirect.txt',
        'https://evil.example.org/steal',
      );
      const text = await refused(fileUrl('redirect.txt', 309));
      expect(text).toBe('Moodle returned HTTP 302 for the file');
      expect(world.network.stray).toEqual([]);
    });
  });
});

describe('read_file with Workers AI bound', () => {
  const world = useWorld({}, { ai: true, clearLogs: true });
  const read = async (file_url: string, extra: Record<string, unknown> = {}) => {
    const result = await McpClient.bearer(world.worker, ALICE.token).call('read_file', {
      file_url,
      ...extra,
    });
    return {
      result,
      json: () => JSON.parse(result.content.at(-1)?.text ?? 'null') as FileText & { mode: string },
    };
  };

  it('converts a PDF to Markdown through the binding, without its metadata or images', async () => {
    const { json } = await read(FILE_URLS.slides);
    expect(json()).toMatchObject({ format: 'pdf', mode: 'markdown', next_offset: null });
    expect(json().text).toBe('## Contents\n### Page 1\nLecture one slides');
    expect(world.ai.calls).toHaveLength(1);
    expect(world.ai.calls[0]).toMatchObject({
      name: 'slides.pdf',
      type: 'application/pdf',
      options: { conversionOptions: { pdf: { metadata: false, images: { convert: false } } } },
    });
    // The file reaches Workers AI byte for byte.
    expect(Buffer.from(world.ai.calls[0]?.bytes ?? []).toString()).toContain('Lecture one slides');
    const logs = await world.worker.logs();
    expect(logs.find((l) => l.msg === 'file converted')).toMatchObject({ format: 'pdf', tokens: 11 });
  });

  it('converts Word documents with Workers AI and HTML with our own converter', async () => {
    expect((await read(fileUrl('syllabus.docx', 303))).json()).toMatchObject({
      mode: 'markdown',
      text: 'Syllabus\nWeek 1: sorting',
    });
    // HTML is converted by our own converter, so only the Word document went to Workers AI.
    expect((await read(fileUrl('page.html', 306))).json()).toMatchObject({
      format: 'html',
      mode: 'extract',
      text: expect.stringContaining('# Welcome') as unknown,
    });
    expect(world.ai.calls.map((c) => c.type)).toEqual([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
  });

  it('returns images as images, and describes one only when markdown is asked for', async () => {
    const image = await read(fileUrl('diagram.png', 304));
    expect(image.result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(world.ai.calls).toEqual([]);

    const described = await read(fileUrl('diagram.png', 304), { mode: 'markdown' });
    expect(described.json()).toMatchObject({ format: 'image', mode: 'markdown' });
    expect(described.json().text).toContain('diagram');
  });

  it('extracts instead when asked to, or when a PDF page is given', async () => {
    expect((await read(FILE_URLS.slides, { mode: 'extract' })).json()).toMatchObject({ mode: 'extract' });
    expect((await read(FILE_URLS.slides, { page: 1 })).json()).toMatchObject({ mode: 'markdown' });
    expect((await read(FILE_URLS.slides, { page: 2 })).json()).toMatchObject({ mode: 'extract' });
    expect(world.ai.calls).toHaveLength(1);
  });

  it('falls back to extraction when Workers AI cannot convert, without logging the file', async () => {
    world.ai.failure = 'slides.pdf: daily free allocation of neurons exceeded';
    const { json } = await read(FILE_URLS.slides);
    expect(json()).toMatchObject({ mode: 'extract', text: '--- Page 1 ---\nLecture one slides' });
    expect(json().note).toContain('Markdown conversion failed');
    const logs = await world.worker.logs();
    expect(logs.find((l) => l.msg === 'markdown conversion failed')).toMatchObject({
      level: 'warn',
      format: 'pdf',
      reason: 'quota',
      error: 'MarkdownConversionError',
    });
    expect(await world.worker.rawLogs()).not.toMatch(/slides\.pdf|neurons|pluginfile/);
  });
});

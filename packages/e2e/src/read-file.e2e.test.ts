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
    expect(json()).toMatchObject({ filename: 'slides.pdf', pages: 1 });
    expect(json().text).toContain('Lecture one slides');
  });

  it('extracts paragraphs from a Word document', async () => {
    const { json } = await read(fileUrl('syllabus.docx', 303));
    expect(json().text).toBe('Syllabus\nWeek 1: sorting');
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

  it('returns the unmodified file when raw is set, whatever its type', async () => {
    const { result } = await read(fileUrl('lecture.mp4', 305), { raw: true });
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

  it('refuses raw files over 20 MB', async () => {
    const { result } = await read(fileUrl('huge.bin', 307), { raw: true });
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

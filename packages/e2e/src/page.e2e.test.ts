import { describe, expect, it } from 'vitest';

import { McpClient, textOf, type ToolResult } from './mcp.ts';
import {
  ALICE,
  BIG_PAGE_HTML,
  BOB,
  COURSE_ALG,
  COURSE_DATA,
  COURSE_DB,
  FILE_URLS,
  IDS,
} from './mock/data.ts';
import { slimmed } from './slimmed.ts';
import { useWorld } from './world.ts';

const alg = COURSE_DATA[COURSE_ALG];
if (!alg) throw new Error('fixture for the Algorithms course is missing');

describe('pages and other activities against a mock Moodle', () => {
  const world = useWorld({}, { ai: true, clearLogs: true });
  const alice = () => McpClient.bearer(world.worker, ALICE.token);
  const jsonAt = (result: ToolResult, index: number) =>
    JSON.parse(result.content[index]?.text ?? 'null') as Record<string, unknown>;

  describe('list_activities', () => {
    it.each([
      ['resource', 'resources'],
      ['url', 'urls'],
      ['label', 'labels'],
      ['glossary', 'glossaries'],
      ['lesson', 'lessons'],
      ['choice', 'choices'],
      ['feedback', 'feedbacks'],
    ])('lists %s', async (type, key) => {
      const result = await alice().call('list_activities', { course_id: COURSE_ALG, type });
      // A label's intro is its text, which comes back as Markdown rather than HTML.
      const items = (alg as unknown as Record<string, Record<string, unknown>[]>)[key] ?? [];
      const expected = items.map((i) => (type === 'label' ? { ...i, intro: '### Exam in January' } : i));
      expect(JSON.parse(textOf(result))).toEqual(slimmed({ [key]: expected, warnings: [] }));
    });

    it('says "none" with an empty list for a course that has none, not an empty answer', async () => {
      const result = await alice().call('list_activities', { course_id: COURSE_DB, type: 'glossary' });
      expect(JSON.parse(textOf(result))).toEqual({ glossaries: [] });
    });

    it('lists pages without their bodies, which get_page then reads', async () => {
      const result = await alice().call('list_activities', { course_id: COURSE_ALG, type: 'page' });
      const { pages } = JSON.parse(textOf(result)) as { pages: Record<string, unknown>[] };
      expect(pages.map((p) => p.coursemodule)).toEqual([IDS.cmidPage, IDS.cmidBigPage]);
      for (const page of pages) expect(page).not.toHaveProperty('content');
      expect(pages[1]?.content_chars).toBe(BIG_PAGE_HTML.length);
      expect(textOf(result).length).toBeLessThan(1500);
    });

    it('is refused for a course the user is not enrolled in', async () => {
      const result = await McpClient.bearer(world.worker, BOB.token).call('list_activities', {
        course_id: COURSE_ALG,
        type: 'page',
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('not enrolled');
    });
  });

  describe('get_page', () => {
    it('reads a page by the cmid in a Moodle link, as the token owner, with two read-only calls', async () => {
      const result = await alice().call('get_page', { cmid: IDS.cmidPage });
      expect(result.isError).toBeUndefined();
      expect(jsonAt(result, 0)).toMatchObject({ page: { cmid: IDS.cmidPage, name: 'Welcome page' } });
      expect(jsonAt(result, 1)).toMatchObject({ text: 'Welcome to **Algorithms**.' });
      expect(world.moodle.restCalls.map((r) => r.fn)).toEqual([
        'core_course_get_course_module',
        'mod_page_get_pages_by_courses',
      ]);
      expect(world.moodle.restCalls.every((r) => r.token === ALICE.token)).toBe(true);
    });

    it('converts with our own converter by default, and through Workers AI only when asked', async () => {
      const auto = await alice().call('get_page', { cmid: IDS.cmidPage });
      expect(jsonAt(auto, 1)).toMatchObject({ mode: 'extract' });
      expect(world.ai.calls).toHaveLength(0);
      const asked = await alice().call('get_page', { cmid: IDS.cmidPage, format: 'markdown' });
      expect(jsonAt(asked, 1)).toMatchObject({ mode: 'markdown' });
      expect(world.ai.calls).toHaveLength(1);
      expect(world.ai.calls[0]).toMatchObject({ type: 'text/html' });
    });

    it('extract and raw never use Workers AI', async () => {
      const extract = await alice().call('get_page', { cmid: IDS.cmidPage, format: 'extract' });
      expect(jsonAt(extract, 1)).toMatchObject({ mode: 'extract', text: 'Welcome to **Algorithms**.' });
      const raw = await alice().call('get_page', { cmid: IDS.cmidPage, format: 'raw' });
      expect(jsonAt(raw, 1)).toMatchObject({ mode: 'raw', text: '<p>Welcome to <b>Algorithms</b>.</p>' });
      expect(world.ai.calls).toHaveLength(0);
    });

    it('falls back to the local converter when the Workers AI allowance is spent', async () => {
      world.ai.failure = 'Neurons allocation exceeded';
      const result = await alice().call('get_page', { cmid: IDS.cmidPage, format: 'markdown' });
      expect(jsonAt(result, 1)).toMatchObject({ mode: 'extract', text: 'Welcome to **Algorithms**.' });
      expect(String(jsonAt(result, 1).note)).toContain('allowance');
    });

    it('keeps tables and links, drops styles, and attaches the pasted picture once', async () => {
      const result = await alice().call('get_page', { cmid: IDS.cmidBigPage, max_chars: 100_000 });
      const text = String(jsonAt(result, 1).text);
      expect(text).toContain('## Sorting');
      expect(text).toContain('| Algorithm | Time |');
      expect(text).toContain('[notes](');
      expect(text).toContain('[image: Diagram]');
      expect(text).not.toMatch(/style=|base64/);
      expect(result.content.filter((b) => b.type === 'image')).toHaveLength(1);
      // Workers AI is bypassed so the picture keeps its place in the text.
      expect(world.ai.calls).toHaveLength(0);
    });

    it('reads a page longer than one call in parts', async () => {
      const first = await alice().call('get_page', {
        cmid: IDS.cmidBigPage,
        format: 'extract',
        max_chars: 1000,
      });
      const head = jsonAt(first, 1);
      expect(head.next_offset).toBe(1000);
      const second = await alice().call('get_page', {
        cmid: IDS.cmidBigPage,
        format: 'extract',
        max_chars: 1000,
        offset: Number(head.next_offset),
      });
      expect(jsonAt(second, 1)).toMatchObject({ offset: 1000 });
      expect(second.content.filter((b) => b.type === 'image')).toHaveLength(0);
    });

    it('says when the cmid is another kind of activity', async () => {
      const result = await alice().call('get_page', { cmid: IDS.cmidAssign });
      expect(jsonAt(result, 0)).toMatchObject({ readable: false });
      expect(String(jsonAt(result, 0).note)).toContain('assign');
    });

    it('lets Moodle refuse a page of a course the user is not enrolled in', async () => {
      const result = await McpClient.bearer(world.worker, BOB.token).call('get_page', { cmid: IDS.cmidPage });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('not enrolled');
    });

    it('logs sizes only, never the page text, its name or a link', async () => {
      await alice().call('get_page', { cmid: IDS.cmidBigPage });
      const logs = (await world.worker.logs()).map((l) => JSON.stringify(l)).join('\n');
      expect(logs).toContain('get_page');
      expect(logs).not.toMatch(/Quicksort|Big page|Filler sentence|pluginfile|alice-secret/);
    });
  });

  describe('get_course_contents', () => {
    it('is a Markdown outline with every id and file URL a model passes on', async () => {
      const result = await alice().call('get_course_contents', { course_id: COURSE_ALG });
      expect(result.content).toHaveLength(1);
      const text = textOf(result);
      expect(text).toMatch(/^# Course outline: 2 sections, 4 activities/);
      expect(text).toContain('## 0. Week 1: Sorting');
      expect(text).toContain(`- assign **Homework 1** (cmid ${IDS.cmidAssign}, instance ${IDS.assign})`);
      expect(text).toContain(`- page **Welcome page** (cmid ${IDS.cmidPage}, instance 30)`);
      expect(text).toContain(`- page **Big page** (cmid ${IDS.cmidBigPage}, instance 31)`);
      expect(text).toContain(`  - file notes.txt (37 B): ${FILE_URLS.notes}`);
      expect(world.moodle.restCalls.map((r) => r.fn)).toEqual(['core_course_get_contents']);
    });

    it('is far smaller than the JSON Moodle sends', async () => {
      const text = textOf(await alice().call('get_course_contents', { course_id: COURSE_ALG }));
      expect(text.length).toBeLessThan(JSON.stringify(alg.contents).length);
    });

    it('lets Moodle refuse a course the user is not enrolled in', async () => {
      const result = await McpClient.bearer(world.worker, BOB.token).call('get_course_contents', {
        course_id: COURSE_ALG,
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('not enrolled');
    });
  });
});

import { describe, expect, it } from 'vitest';

import { callTool, restCalls, setup } from '../app-test-utils.ts';
import { fakeMarkdown, type RecordedCall, testConfig } from '../test-utils.ts';
import { ToolName } from './names.ts';

const CMID = 8;
const PAGE_HTML =
  '<h2>Rules</h2><p style="color:red">Read <b>all</b> of <a href="https://x.test/a">it</a>.</p>' +
  '<table><tr><th>A</th></tr><tr><td>1</td></tr></table>';

interface PageFixture {
  coursemodule: number;
  id: number;
  name: string;
  content: string;
  timemodified?: number;
}

/** A Moodle that knows one course holding the given pages, the first being activity `CMID`. */
const moodleWith =
  (pages: PageFixture[], modname = 'page') =>
  (call: RecordedCall) => {
    const fn = (call.body as Record<string, string>).wsfunction;
    if (fn === 'core_course_get_course_module') return { cm: { course: 3, instance: 1, modname } };
    if (fn === 'mod_page_get_pages_by_courses') return { pages, warnings: [] };
    return {};
  };

const PAGE: PageFixture = { id: 1, coursemodule: CMID, name: 'Rules', content: PAGE_HTML, timemodified: 5 };

interface Block {
  type: string;
  text?: string;
  data?: string;
}

async function getPage(
  pages: PageFixture[],
  args: Record<string, unknown> = {},
  options: { markdown?: ReturnType<typeof fakeMarkdown>; modname?: string } = {},
) {
  const { app, moodle, logs } = setup(
    moodleWith(pages, options.modname),
    testConfig(),
    options.markdown ? { markdown: options.markdown.converter } : {},
  );
  const { body } = await callTool(app, ToolName.GetPage, { cmid: CMID, ...args });
  const content = (body.result?.content ?? []) as Block[];
  const json = (index: number) => JSON.parse(content[index]?.text ?? 'null') as Record<string, unknown>;
  return { body, content, json, moodle, logs };
}

describe('get_page', () => {
  it('finds the page by its course-module id, asking Moodle only for that page’s course', async () => {
    const other: PageFixture = { id: 2, coursemodule: 99, name: 'Other', content: '<p>no</p>' };
    const { json, moodle } = await getPage([other, PAGE]);
    expect(json(0)).toEqual({ page: { cmid: CMID, id: 1, name: 'Rules', timemodified: 5 } });
    expect(restCalls(moodle).map((c) => (c.body as Record<string, string>).wsfunction)).toEqual([
      'core_course_get_course_module',
      'mod_page_get_pages_by_courses',
    ]);
    expect(restCalls(moodle)[1]?.body).toMatchObject({ 'courseids[0]': '3' });
  });

  it('converts the page to Markdown with our own converter when no AI is configured', async () => {
    const { json } = await getPage([PAGE]);
    expect(json(1)).toMatchObject({
      format: 'html',
      mode: 'extract',
      next_offset: null,
      text: '## Rules\n\nRead **all** of [it](https://x.test/a).\n\n| A |\n| --- |\n| 1 |',
    });
  });

  it('uses Workers AI only when markdown is asked for, and says so', async () => {
    const markdown = fakeMarkdown(() => '# From AI');
    const { json } = await getPage([PAGE], { format: 'markdown' }, { markdown });
    expect(json(1)).toMatchObject({ mode: 'markdown', text: '# From AI' });
    expect(markdown.calls[0]).toMatchObject({ type: 'text/html' });
    expect(markdown.calls[0]?.text).toContain('Read');
  });

  it.each(['auto', 'extract'])('%s uses our own converter even when Workers AI is there', async (format) => {
    const markdown = fakeMarkdown();
    const { json } = await getPage([PAGE], { format }, { markdown });
    expect(json(1)).toMatchObject({ mode: 'extract' });
    expect(json(1).text).toContain('## Rules');
    expect(markdown.calls).toHaveLength(0);
  });

  it('falls back to our converter when Workers AI fails', async () => {
    const markdown = fakeMarkdown(() => new Error('quota exceeded: neurons'));
    const { json } = await getPage([PAGE], { format: 'markdown' }, { markdown });
    expect(json(1)).toMatchObject({ mode: 'extract' });
    expect(json(1).text).toContain('## Rules');
    expect(json(1).note).toContain('Markdown conversion failed');
  });

  it('raw returns the HTML without scripts, styles or picture bytes', async () => {
    const content = `<style>p{}</style><script>x()</script>${PAGE_HTML}`;
    const { json } = await getPage([{ ...PAGE, content }], { format: 'raw' });
    expect(json(1)).toMatchObject({ format: 'html', mode: 'raw', next_offset: null });
    expect(json(1).text).toBe(PAGE_HTML);
  });

  it('pages long content with offset and max_chars', async () => {
    const content = `<p>${'x'.repeat(1500)}${'y'.repeat(500)}</p>`;
    const first = await getPage([{ ...PAGE, content }], { format: 'extract', max_chars: 1000 });
    expect(first.json(1)).toMatchObject({ total_chars: 2000, next_offset: 1000 });
    const last = await getPage([{ ...PAGE, content }], { format: 'extract', max_chars: 1000, offset: 1000 });
    expect(last.json(1)).toMatchObject({ next_offset: null, offset: 1000 });
    const raw = await getPage([{ ...PAGE, content }], { format: 'raw', max_chars: 1000 });
    expect(raw.json(1)).toMatchObject({ total_chars: content.length, next_offset: 1000 });
  });

  describe('pictures pasted into the page', () => {
    const picture = '<img alt="Fig" src="data:image/png;base64,iVBORw0KGgo=">';
    const withPicture: PageFixture = { ...PAGE, content: `<p>See</p>${picture}` };

    it('are attached once, and our converter marks where they sat', async () => {
      const markdown = fakeMarkdown();
      const { content, json } = await getPage([withPicture], {}, { markdown });
      expect(markdown.calls).toHaveLength(0);
      expect(json(1)).toMatchObject({ mode: 'extract', text: 'See\n\n[image: Fig]' });
      expect(content.map((b) => b.type)).toEqual(['text', 'text', 'image', 'text']);
      expect(content[2]?.data).toBe('iVBORw0KGgo=');
      expect(content[3]?.text).toContain('1 image(s)');
    });

    it('are not sent to Workers AI when it is asked for', async () => {
      const markdown = fakeMarkdown();
      await getPage([withPicture], { format: 'markdown' }, { markdown });
      expect(markdown.calls[0]?.text).not.toContain('base64');
    });

    it('are attached only with the first part of a long page', async () => {
      const { content } = await getPage([withPicture], { format: 'extract', offset: 1 });
      expect(content.map((b) => b.type)).toEqual(['text', 'text']);
    });
  });

  it('shows the part of multi-language markup in the user’s language', async () => {
    const respond = moodleWith([
      {
        ...PAGE,
        name: '{mlang pl}Zasady{mlang}{mlang en}Rules{mlang}',
        content: '<p>{mlang pl}Cześć{mlang}{mlang en}Hello{mlang}</p>',
      },
    ]);
    const { app } = setup((call) =>
      (call.body as Record<string, string>).wsfunction === 'core_webservice_get_site_info'
        ? { userid: 1, lang: 'pl' }
        : respond(call),
    );
    const { body } = await callTool(app, ToolName.GetPage, { cmid: CMID, format: 'extract' });
    const [head, text] = (body.result?.content ?? []).map(
      (b) => JSON.parse(b.text) as Record<string, unknown>,
    );
    expect(head).toMatchObject({ page: { name: 'Zasady' } });
    expect(text).toMatchObject({ text: 'Cześć' });
  });

  it('explains when the activity is not a page, without fetching pages', async () => {
    const { json, moodle } = await getPage([PAGE], {}, { modname: 'quiz' });
    expect(json(0)).toMatchObject({ readable: false });
    expect(json(0).note).toContain('a quiz, not a page');
    expect(restCalls(moodle)).toHaveLength(1);
  });

  it('explains when the page is not in the course’s list', async () => {
    const { json } = await getPage([{ ...PAGE, coursemodule: 99 }]);
    expect(json(0)).toMatchObject({ readable: false, note: 'The page is not visible to this user.' });
  });

  it('logs sizes only, never the page text or its name', async () => {
    const { logs } = await getPage([{ ...PAGE, name: 'SECRET-NAME', content: '<p>SECRET-TEXT</p>' }], {
      format: 'extract',
    });
    expect(logs.join('\n')).not.toMatch(/SECRET/);
  });

  it('rejects an out-of-range max_chars without calling Moodle', async () => {
    const { body, moodle } = await getPage([PAGE], { max_chars: 5 });
    expect(body.result?.isError ?? body.error).toBeTruthy();
    expect(moodle.calls).toHaveLength(0);
  });
});

describe('list_activities', () => {
  const lists: [string, string, string][] = [
    ['resource', 'mod_resource_get_resources_by_courses', 'resources'],
    ['page', 'mod_page_get_pages_by_courses', 'pages'],
    ['url', 'mod_url_get_urls_by_courses', 'urls'],
    ['label', 'mod_label_get_labels_by_courses', 'labels'],
    ['glossary', 'mod_glossary_get_glossaries_by_courses', 'glossaries'],
    ['lesson', 'mod_lesson_get_lessons_by_courses', 'lessons'],
    ['choice', 'mod_choice_get_choices_by_courses', 'choices'],
    ['feedback', 'mod_feedback_get_feedbacks_by_courses', 'feedbacks'],
  ];

  it.each(lists)('lists %s activities with %s', async (type, fn, key) => {
    const { app, moodle } = setup(() => ({ [key]: [{ id: 1, name: 'N' }], warnings: [] }));
    const { body } = await callTool(app, ToolName.ListActivities, { course_id: 3, type });
    expect(restCalls(moodle)).toHaveLength(1);
    expect(restCalls(moodle)[0]?.body).toMatchObject({ wsfunction: fn, 'courseids[0]': '3' });
    expect(JSON.parse(body.result?.content?.[0]?.text ?? '')).toMatchObject({
      [key]: [{ id: 1, name: 'N' }],
    });
  });

  it('describes pages instead of returning their bodies', async () => {
    const { app } = setup(() => ({
      pages: [
        {
          id: 1,
          coursemodule: 8,
          name: 'P',
          content: '<p>abc</p>',
          contentfiles: [{ fileurl: 'a' }, { fileurl: 'b' }],
          displayoptions: 'a:3:{}',
          enableaitools: null,
        },
      ],
    }));
    const { body } = await callTool(app, ToolName.ListActivities, { course_id: 3, type: 'page' });
    const result = JSON.parse(body.result?.content?.[0]?.text ?? '') as { pages: Record<string, unknown>[] };
    expect(result.pages[0]).toEqual({
      id: 1,
      coursemodule: 8,
      name: 'P',
      content_files: 2,
      content_chars: 10,
    });
  });

  it('keeps the bodies of other kinds, such as labels', async () => {
    const { app } = setup(() => ({ labels: [{ id: 1, intro: '<h3>Exam</h3>' }] }));
    const { body } = await callTool(app, ToolName.ListActivities, { course_id: 3, type: 'label' });
    expect(body.result?.content?.[0]?.text).toContain('<h3>Exam</h3>');
  });

  it('rejects an unknown type without calling Moodle', async () => {
    const { app, moodle } = setup();
    const { body } = await callTool(app, ToolName.ListActivities, { course_id: 3, type: 'scorm' });
    expect(body.result?.isError ?? body.error).toBeTruthy();
    expect(moodle.calls).toHaveLength(0);
  });
});

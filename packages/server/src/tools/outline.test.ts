import { describe, expect, it } from 'vitest';

import { callTool, restCalls, setup } from '../app-test-utils.ts';
import type { RecordedCall } from '../test-utils.ts';
import { ToolName } from './names.ts';
import { renderOutline } from './outline.ts';

const SECTIONS = [
  {
    id: 1,
    name: 'Week 1',
    section: 1,
    visible: 1,
    summary: '<p>Start <b>here</b></p>',
    modules: [
      {
        id: 217643,
        name: '5.1b',
        modname: 'page',
        instance: 12987,
        description: '',
        visible: 1,
        uservisible: true,
        modicon: 'https://x.test/icon.svg',
        completion: 1,
        completiondata: { state: 1 },
      },
      {
        id: 2003,
        name: 'Lecture notes',
        modname: 'resource',
        instance: 20,
        description: '<p>Read <i>before</i> class</p>',
        contents: [
          {
            type: 'file',
            filename: 'slides.pdf',
            filepath: '/',
            filesize: 2048,
            fileurl: 'https://x.test/webservice/pluginfile.php/1/slides.pdf',
          },
        ],
      },
      {
        id: 2004,
        name: 'Visualgo',
        modname: 'url',
        instance: 40,
        contents: [{ type: 'url', fileurl: 'https://visualgo.net/' }],
      },
      { id: 2005, name: 'Exam in…', modname: 'label', description: '<h3>Exam in January</h3>' },
      {
        id: 2006,
        name: 'Homework 1',
        modname: 'assign',
        instance: 7,
        visible: 0,
        uservisible: false,
        dates: [{ label: 'Due:', timestamp: 1_762_000_000 }],
      },
    ],
  },
  { id: 2, name: '', section: 2, visible: 0, modules: [] },
];

describe('renderOutline', () => {
  it('writes a heading per section and a line per activity with its ids, state and dates', () => {
    expect(renderOutline(SECTIONS)).toBe(
      [
        '# Course outline: 2 sections, 5 activities',
        "An activity's `cmid` is for get_page and get_course_module; its `instance` is the id the tool for its type takes; a file URL goes to read_file.",
        '',
        '## 1. Week 1',
        'Start **here**',
        '- page **5.1b** (cmid 217643, instance 12987) — done',
        '- resource **Lecture notes** (cmid 2003, instance 20)',
        '  > Read *before* class',
        '  - file slides.pdf (2 KB): https://x.test/webservice/pluginfile.php/1/slides.pdf',
        '- url **Visualgo** (cmid 2004, instance 40)',
        '  - link: https://visualgo.net/',
        '- label (cmid 2005): ### Exam in January',
        '- assign **Homework 1** (cmid 2006, instance 7) — hidden; not available to you; Due: 2025-11-01 12:26 UTC',
        '',
        '## 2. Section 2 (hidden)',
      ].join('\n'),
    );
  });

  it('keeps every id and file URL a model needs to call the next tool', () => {
    const text = renderOutline(SECTIONS);
    for (const needle of ['217643', '12987', 'https://x.test/webservice/pluginfile.php/1/slides.pdf'])
      expect(text).toContain(needle);
  });

  it('leaves out icons, settings and tracking fields', () => {
    expect(renderOutline(SECTIONS)).not.toMatch(/icon|completiondata|uservisible|modicon/);
  });

  it('shortens long descriptions and names the folder of a file inside one', () => {
    const text = renderOutline([
      {
        section: 0,
        modules: [
          {
            id: 1,
            name: 'Folder',
            modname: 'folder',
            instance: 2,
            description: `<p>${'word '.repeat(300)}</p>`,
            contents: [{ type: 'file', filename: 'a.txt', filepath: '/sub/', fileurl: 'https://x.test/a' }],
          },
        ],
      },
    ]);
    expect(text).toContain('…');
    expect(text).toContain('  - file /sub/a.txt: https://x.test/a');
    expect(text.length).toBeLessThan(900);
  });

  it('shows the completion state only when the activity tracks completion', () => {
    const module = (completion: number, state: number) => ({
      id: 1,
      name: 'A',
      modname: 'page',
      completion,
      completiondata: { state },
    });
    expect(renderOutline([{ modules: [module(0, 1)] }])).not.toMatch(/done|to do/);
    expect(renderOutline([{ modules: [module(2, 0)] }])).toContain('— to do');
    expect(renderOutline([{ modules: [module(2, 3)] }])).toContain('— done (failed)');
  });

  it('picks the user’s language in every field separately', () => {
    const ml = (pl: string, en: string) => `{mlang pl}${pl}{mlang}{mlang en}${en}{mlang}`;
    const sections = [
      {
        name: ml('Tydzień', 'Week'),
        modules: [
          {
            id: 1,
            name: ml('Zadanie', 'Task'),
            modname: 'assign',
            description: `<p>${ml('Opis', 'Text')}</p>`,
          },
          { id: 2, name: ml('Quiz', 'Test'), modname: 'quiz' },
        ],
      },
    ];
    const text = renderOutline(sections, 'pl');
    expect(text).toContain('## 0. Tydzień');
    expect(text).toContain('**Zadanie**');
    expect(text).toContain('> Opis');
    expect(text).toContain('**Quiz**');
    expect(text).not.toContain('mlang');
  });
});

describe('get_course_contents', () => {
  const sections = (call: RecordedCall) =>
    (call.body as Record<string, string>).wsfunction === 'core_webservice_get_site_info'
      ? { lang: 'en' }
      : SECTIONS;

  it('returns the outline as Markdown for the course asked for', async () => {
    const { app, moodle } = setup(sections);
    const { body } = await callTool(app, ToolName.GetCourseContents, { course_id: 3 });
    expect(restCalls(moodle)[0]?.body).toMatchObject({ courseid: '3' });
    expect(body.result?.content).toHaveLength(1);
    expect(body.result?.content?.[0]?.text).toMatch(/^# Course outline: 2 sections, 5 activities/);
  });

  it('does not look up the user’s language when no text needs it', async () => {
    const { app, moodle } = setup(sections);
    await callTool(app, ToolName.GetCourseContents, { course_id: 3 });
    expect(restCalls(moodle)).toHaveLength(1);
  });

  it('cuts an outline too long for a client, and says so', async () => {
    const big = [
      {
        section: 1,
        modules: Array.from({ length: 2000 }, (_, i) => ({
          id: i + 1,
          name: `Activity ${i}`,
          modname: 'page',
          instance: i,
          description: `<p>${'text '.repeat(80)}</p>`,
        })),
      },
    ];
    const { app } = setup(() => big);
    const { body } = await callTool(app, ToolName.GetCourseContents, { course_id: 3 });
    const text = body.result?.content?.[0]?.text ?? '';
    expect(text.length).toBeLessThanOrEqual(80_000);
    expect(JSON.parse(text)).toMatchObject({ truncated: true });
  });

  it('treats an unexpected answer as an empty course instead of failing', async () => {
    const { app } = setup(() => ({}));
    const { body } = await callTool(app, ToolName.GetCourseContents, { course_id: 3 });
    expect(body.result?.content?.[0]?.text).toContain('0 sections, 0 activities');
  });
});

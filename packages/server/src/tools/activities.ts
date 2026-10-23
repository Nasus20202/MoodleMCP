import * as z from 'zod/v4';

import { embeddedImages, extractEmbeddedImages } from '../files/embedded-images.ts';
import { ReadMode } from '../files/mode.ts';
import { pageText } from '../files/read.ts';
import { MoodleFunction } from '../moodle/functions.ts';
import { defineCustomTool, imageNote, jsonContent, renderResult, type ToolContent } from './define.ts';
import { ToolName } from './names.ts';
import { embeddedImageBlocks, readHtml } from './read-file.ts';
import { DEFAULT_CHARS, MAX_CHARS } from './read-file-results.ts';
import { resolveMlang, stripHtmlBloat } from './tidy.ts';

/** How a kind of activity is listed: the Moodle function and the key its list sits under. */
interface ActivityKind {
  fn: MoodleFunction;
  key: string;
  what: string;
}

const KINDS = {
  resource: { fn: MoodleFunction.Resources, key: 'resources', what: 'files (slides, notes, documents)' },
  page: { fn: MoodleFunction.Pages, key: 'pages', what: 'pages' },
  url: { fn: MoodleFunction.Urls, key: 'urls', what: 'external links' },
  label: { fn: MoodleFunction.Labels, key: 'labels', what: 'text labels' },
  glossary: { fn: MoodleFunction.Glossaries, key: 'glossaries', what: 'glossaries' },
  lesson: { fn: MoodleFunction.Lessons, key: 'lessons', what: 'lessons' },
  choice: { fn: MoodleFunction.Choices, key: 'choices', what: 'choices (polls)' },
  feedback: { fn: MoodleFunction.Feedbacks, key: 'feedbacks', what: 'feedback surveys' },
} as const satisfies Record<string, ActivityKind>;

type KindName = keyof typeof KINDS;
const KIND_NAMES = Object.keys(KINDS) as [KindName, ...KindName[]];

const courseId = z
  .number()
  .int()
  .positive()
  .describe('Moodle course id: the `id` of a course from list_courses or search_courses');

/**
 * A page in a list is described, not shown: its body and its file list (every picture in it) can run to
 * hundreds of kilobytes for a course. Read the page with get_page.
 */
function describePage(page: unknown): unknown {
  if (typeof page !== 'object' || page === null) return page;
  const { id, coursemodule, course, name, intro, timemodified, section, visible, content, contentfiles } =
    page as Record<string, unknown>;
  return {
    id,
    coursemodule,
    course,
    name,
    intro,
    section,
    visible,
    timemodified,
    content_chars: typeof content === 'string' ? content.length : 0,
    content_files: Array.isArray(contentfiles) ? contentfiles.length : 0,
  };
}

export const listActivitiesTool = defineCustomTool({
  name: ToolName.ListActivities,
  description:
    "List one kind of a course's activities: `resource` (files with their `fileurl`, for read_file), `page` " +
    '(name and size only: read one with get_page), `url` (external links; you cannot open them, give them to ' +
    'the user), `label` (headings and instructions placed between activities, as HTML), `glossary` (then ' +
    'get_glossary_entries), `lesson` (then get_lesson_pages), `choice` (then get_choice_results) or ' +
    '`feedback` (then get_feedback_analysis). Each item has an `id` (its instance id) and a `coursemodule` ' +
    '(the cmid in Moodle links). Lighter than get_course_contents when you need one kind. Assignments, ' +
    'quizzes, forums and wikis have their own list tools.',
  input: z.object({
    course_id: courseId,
    type: z.enum(KIND_NAMES).describe('the kind of activity to list'),
  }),
  async run({ client }, { course_id, type }) {
    const kind: ActivityKind = KINDS[type];
    const result = await client.call<Record<string, unknown>>(kind.fn, { 'courseids[0]': course_id });
    const list = result[kind.key];
    const shaped =
      type === 'page' && Array.isArray(list) ? { ...result, [kind.key]: list.map(describePage) } : result;
    return renderResult(client, shaped);
  },
});

const FORMATS = ['auto', 'markdown', 'extract', 'raw'] as const;

interface CourseModule {
  cm?: { course?: number; instance?: number; modname?: string };
}

interface PageRecord {
  id: number;
  coursemodule: number;
  name?: string;
  content?: string;
  timemodified?: number;
}

export const getPageTool = defineCustomTool({
  name: ToolName.GetPage,
  description:
    "Read one Page activity's content. `cmid` is the `coursemodule` of a page from list_activities (type " +
    'page), the `id` of a page module in get_course_contents, or the `id` in a Moodle link ' +
    '(`.../mod/page/view.php?id=123`). `format`: auto (default) and extract are Markdown from our own ' +
    'converter, which keeps headings, lists, links and tables; markdown asks Workers AI instead (falling ' +
    'back to our converter), which can leave stray markers; raw is the HTML as Moodle stores it. Pictures pasted into the page are attached as images after the text. A long page comes back ' +
    'in parts: if `next_offset` is not null, call again with `offset` set to it. Links to files in the page ' +
    'can be given to read_file.',
  input: z.object({
    cmid: z
      .number()
      .int()
      .positive()
      .describe('course-module id of a page: `coursemodule` in list_activities, or `id` in a Moodle link'),
    format: z
      .enum(FORMATS)
      .default('auto')
      .describe('auto (default), markdown (Workers AI), extract (our converter) or raw (HTML)'),
    offset: z.number().int().min(0).default(0).describe('character to start from; use `next_offset`'),
    max_chars: z
      .number()
      .int()
      .min(1000)
      .max(MAX_CHARS)
      .default(DEFAULT_CHARS)
      .describe(`most characters to return (default ${DEFAULT_CHARS}, max ${MAX_CHARS})`),
  }),
  async run(context, { cmid, format, offset, max_chars }) {
    const { client } = context;
    const { cm } = await client.call<CourseModule>(MoodleFunction.CourseModule, { cmid });
    if (cm?.modname !== 'page' || cm.course === undefined) {
      return jsonContent({
        readable: false,
        note: `That activity is ${cm?.modname ? `a ${cm.modname}, not a page` : 'not a page'}; use the tool for its type.`,
      });
    }
    const { pages } = await client.call<{ pages?: PageRecord[] }>(MoodleFunction.Pages, {
      'courseids[0]': cm.course,
    });
    const page = pages?.find((p) => p.coursemodule === cmid);
    if (!page) {
      return jsonContent({ readable: false, note: 'The page is not visible to this user.' });
    }

    let html = page.content ?? '';
    let name = page.name ?? 'page';
    if (html.includes('{mlang') || name.includes('{mlang')) {
      const lang = await client.lang();
      html = resolveMlang(html, lang);
      name = resolveMlang(name, lang);
    }
    const header = jsonContent({ page: { cmid, id: page.id, name, timemodified: page.timemodified } });

    if (format === 'raw') {
      const { value, images, skipped } = extractEmbeddedImages(html);
      const text = stripHtmlBloat(String(value));
      const { slice, totalChars, nextOffset } = pageText(text, { offset, maxChars: max_chars });
      const attached = offset === 0 ? images : [];
      return [
        ...header,
        ...jsonContent({
          format: 'html',
          mode: 'raw',
          total_chars: totalChars,
          offset,
          next_offset: nextOffset,
          text: slice,
        }),
        ...attached.map((image): ToolContent => ({
          type: 'image',
          data: image.base64,
          mimeType: image.mimeType,
        })),
        ...(attached.length > 0 || skipped > 0
          ? jsonContent({ note: imageNote(attached.length, skipped) })
          : []),
      ];
    }

    const pictures = embeddedImages(html);
    const hasPictures = pictures.images.length > 0 || pictures.skipped > 0;
    // auto is our own converter: cleaner than Workers AI on editor markup, and it marks where pictures sat.
    const mode = format === 'markdown' ? ReadMode.Markdown : ReadMode.Extract;
    // Pictures are attached from the original HTML below; the converter gets it without their bytes.
    const content = await readHtml(context, stripHtmlBloat(html), name, { mode, offset, max_chars });
    return [...header, ...content, ...(offset === 0 && hasPictures ? embeddedImageBlocks(html) : [])];
  },
});

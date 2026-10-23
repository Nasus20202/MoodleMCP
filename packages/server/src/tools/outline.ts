import * as z from 'zod/v4';

import { htmlToMarkdown } from '../files/html-markdown.ts';
import { MoodleFunction } from '../moodle/functions.ts';
import { defineCustomTool, limitResult, type ToolContent } from './define.ts';
import { ToolName } from './names.ts';
import { resolveMlang, stripHtmlBloat } from './tidy.ts';

/** Longest text of a section summary or an activity description in the outline; the activity has the rest. */
const TEXT_CHARS = 500;

interface CourseFile {
  type?: string;
  filename?: string;
  filepath?: string;
  filesize?: number;
  fileurl?: string;
}

interface ModuleDate {
  label?: string;
  timestamp?: number;
}

interface CourseModule {
  id: number;
  name?: string;
  modname?: string;
  instance?: number;
  description?: string;
  visible?: number;
  uservisible?: boolean;
  completion?: number;
  completiondata?: { state?: number };
  dates?: ModuleDate[];
  contents?: CourseFile[];
}

interface CourseSection {
  id?: number;
  name?: string;
  section?: number;
  visible?: number;
  uservisible?: boolean;
  summary?: string;
  modules?: CourseModule[];
}

/** Picks the part of a field's multi-language markup (`{mlang pl}…{mlang}`) in the user's language. */
type Language = (text: string | undefined) => string | undefined;

/** Moodle's completion states for a user. */
const COMPLETION = ['to do', 'done', 'done (passed)', 'done (failed)'] as const;

const day = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ');

const kilobytes = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`);

/** Markdown of an HTML text on one line, at most {@link TEXT_CHARS} characters. */
function brief(html: string | undefined, language: Language): string {
  const text = htmlToMarkdown(stripHtmlBloat(language(html) ?? '')).replace(/\s+/g, ' ');
  return text.length > TEXT_CHARS ? `${text.slice(0, TEXT_CHARS)}…` : text;
}

function fileLine(file: CourseFile): string | undefined {
  if (!file.fileurl) return undefined;
  if (file.type === 'url') return `  - link: ${file.fileurl}`;
  if (file.type !== undefined && file.type !== 'file') return undefined;
  const name = `${file.filepath && file.filepath !== '/' ? file.filepath : ''}${file.filename ?? 'file'}`;
  return `  - file ${name}${file.filesize === undefined ? '' : ` (${kilobytes(file.filesize)})`}: ${file.fileurl}`;
}

function activityLines(module: CourseModule, language: Language): string[] {
  const flags = [
    module.visible === 0 ? 'hidden' : undefined,
    module.uservisible === false ? 'not available to you' : undefined,
    module.completion && module.completion > 0
      ? (COMPLETION[module.completiondata?.state ?? 0] ?? undefined)
      : undefined,
    ...(module.dates ?? []).map((d) =>
      d.label && d.timestamp !== undefined
        ? `${d.label.replace(/:$/, '')}: ${day(d.timestamp)} UTC`
        : undefined,
    ),
  ].filter(Boolean);
  const description = brief(module.description, language);
  const kind = module.modname ?? 'activity';
  // A label is its text: its name is only that text, shortened.
  const head =
    kind === 'label'
      ? `- label (cmid ${module.id})${description ? `: ${description}` : ''}`
      : `- ${kind} **${language(module.name) ?? ''}** (cmid ${module.id}${module.instance === undefined ? '' : `, instance ${module.instance}`})`;
  return [
    flags.length > 0 ? `${head} — ${flags.join('; ')}` : head,
    ...(kind !== 'label' && description ? [`  > ${description}`] : []),
    ...(module.contents ?? []).map(fileLine).filter((line): line is string => line !== undefined),
  ];
}

/**
 * The outline of a course as Markdown: a heading per section and a line per activity with its ids, state and
 * dates, and under it the files and links it holds. Settings nobody reads (icons, view options, tracking flags)
 * are left out.
 */
export function renderOutline(sections: CourseSection[], lang?: string): string {
  const language: Language = (text) =>
    lang !== undefined && text?.includes('{mlang') ? resolveMlang(text, lang) : text;
  const activities = sections.reduce((sum, s) => sum + (s.modules?.length ?? 0), 0);
  const out = [
    `# Course outline: ${sections.length} sections, ${activities} activities`,
    "An activity's `cmid` is for get_page and get_course_module; its `instance` is the id the tool for its type " +
      'takes; a file URL goes to read_file.',
  ];
  sections.forEach((section, index) => {
    const number = section.section ?? index;
    const given = language(section.name)?.trim();
    const name = given === undefined || given === '' ? `Section ${number}` : given;
    const hidden =
      section.visible === 0 ? ' (hidden)' : section.uservisible === false ? ' (not available to you)' : '';
    out.push('', `## ${number}. ${name}${hidden}`);
    const summary = brief(section.summary, language);
    if (summary) out.push(summary);
    for (const module of section.modules ?? []) out.push(...activityLines(module, language));
  });
  return out.join('\n');
}

export const getCourseContentsTool = defineCustomTool({
  name: ToolName.GetCourseContents,
  description:
    'Show the outline of a course as Markdown: every section with its activities (files, pages, assignments, ' +
    'quizzes, forums, links, labels) in the order students see them. Each activity line gives its type, name, ' +
    '`cmid` (the id in a Moodle link: for get_page and get_course_module), `instance` id (what list_assignments, ' +
    'list_forums, list_quizzes and so on call `assign_id`/`forum_id`/`quiz_id`), whether it is hidden or done, ' +
    'and its dates. Under files and folders are their `fileurl`s: pass one to read_file to read the document. ' +
    'Labels are shown with their text. Descriptions are shortened; read a page with get_page. This is the best ' +
    'first look at a course; for one kind of activity use list_activities.',
  input: z.object({
    course_id: z
      .number()
      .int()
      .positive()
      .describe('Moodle course id: the `id` of a course from list_courses or search_courses'),
  }),
  async run({ client }, { course_id }): Promise<ToolContent[]> {
    const result = await client.call<CourseSection[]>(MoodleFunction.CourseContents, { courseid: course_id });
    const sections = Array.isArray(result) ? result : [];
    // The user's language costs a request, so it is asked for only when some text has multi-language markup.
    const lang = JSON.stringify(sections).includes('{mlang') ? await client.lang() : undefined;
    return [{ type: 'text', text: limitResult(renderOutline(sections, lang)) }];
  },
});

import { htmlToMarkdown } from '../files/html-markdown.ts';
import { stripHtmlBloat } from './tidy.ts';

/**
 * Extractors for tools whose Moodle answer is mostly settings and markup the model never reads. Each keeps the
 * fields that answer the question the tool is asked, and every id another tool takes, and drops the rest.
 */

export type Fields = Record<string, unknown>;

export const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The listed fields of `item` that it has. */
const pick = (item: unknown, fields: readonly string[]): Fields =>
  isFields(item) ? Object.fromEntries(fields.filter((f) => f in item).map((f) => [f, item[f]])) : {};

/** Applies `fn` to the list under `key` of a result; anything of another shape is returned as it is. */
function mapList(result: unknown, key: string, fn: (item: unknown) => unknown): unknown {
  if (!isFields(result) || !Array.isArray(result[key])) return result;
  return { ...result, [key]: result[key].map(fn) };
}

/**
 * An HTML text as one line of Markdown, cut at `max` characters. Intros of activities are long pages of markup
 * for a few sentences of text; the activity itself (get_page and so on) has the full text.
 */
export function shortMarkdown(html: string, max = 800): string {
  const text = htmlToMarkdown(stripHtmlBloat(html)).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** {@link shortMarkdown} for a field that may hold anything: only a string is changed. */
export const briefHtml = (value: unknown, max = 800): unknown =>
  typeof value === 'string' ? shortMarkdown(value, max) : value;

/** The same item with its `intro` as {@link briefHtml}. */
export function withBriefIntro(item: unknown, max = 800): unknown {
  return isFields(item) && 'intro' in item ? { ...item, intro: briefHtml(item.intro, max) } : item;
}

/**
 * A page in a list is described, not shown: its body and its file list (every picture in it) can run to
 * hundreds of kilobytes for a course. Read the page with get_page.
 */
export function describePage(page: unknown): unknown {
  if (!isFields(page)) return page;
  const described = {
    ...pick(page, ['id', 'coursemodule', 'course', 'name', 'intro', 'section', 'visible', 'timemodified']),
    content_chars: typeof page.content === 'string' ? page.content.length : 0,
    content_files: Array.isArray(page.contentfiles) ? page.contentfiles.length : 0,
  };
  return withBriefIntro(described, 500);
}

/**
 * Any other activity of a list: its list of intro pictures (`introfiles`), which can be longer than the item,
 * becomes a count (the pictures are in the text of the item), and its intro short Markdown. The intro of a
 * label is its text, of the others a few sentences in markup.
 */
export function describeItem(item: unknown): unknown {
  if (!isFields(item)) return item;
  const { introfiles, ...rest } = item;
  const described =
    'introfiles' in item ? { ...rest, intro_files: Array.isArray(introfiles) ? introfiles.length : 0 } : item;
  return withBriefIntro(described, 1500);
}

/** The fields of `core_webservice_get_site_info` worth showing; it also holds a private key and ~480 function names. */
const SITE_INFO_FIELDS = [
  'sitename',
  'siteurl',
  'username',
  'firstname',
  'lastname',
  'fullname',
  'lang',
  'userid',
  'release',
  'version',
] as const;

export const pickSiteInfo = (info: unknown): unknown =>
  isFields(info) ? pick(info, SITE_INFO_FIELDS) : info;

const COURSE_FIELDS = [
  'id',
  'shortname',
  'fullname',
  'visible',
  'hidden',
  'startdate',
  'enddate',
  'progress',
  'lastaccess',
] as const;

/**
 * The user's courses as a list to choose from: ids, names, dates and progress. The rest (summary HTML, image
 * links, completion and display settings) is most of the size. Courses the user has not hidden on their
 * dashboard come first; every course stays in the list, since `hidden` is the user's tidiness, not relevance.
 */
export function pickCourses(result: unknown): unknown {
  if (!Array.isArray(result)) return result;
  const courses: Fields[] = result.map((course) => ({
    ...pick(course, COURSE_FIELDS),
    ...(isFields(course) && typeof course.summary === 'string' && course.summary !== ''
      ? { summary: shortMarkdown(course.summary, 200) }
      : {}),
  }));
  const shown = courses.filter((course) => course.hidden !== true);
  return [...shown, ...courses.filter((course) => course.hidden === true)];
}

/** The same item without the listed fields. */
const omit = (item: unknown, fields: ReadonlySet<string>): unknown =>
  isFields(item) ? Object.fromEntries(Object.entries(item).filter(([key]) => !fields.has(key))) : item;

/** Settings of an assignment that no student reads (notifications, marking workflow, teams, submission plugins). */
const ASSIGNMENT_NOISE = new Set([
  'nosubmissions',
  'submissiondrafts',
  'sendnotifications',
  'sendlatenotifications',
  'sendstudentnotifications',
  'gradepenalty',
  'completionsubmit',
  'gradingduedate',
  'requireallteammemberssubmit',
  'teamsubmissiongroupingid',
  'blindmarking',
  'hidegrader',
  'revealidentities',
  'attemptreopenmethod',
  'markingworkflow',
  'markingallocation',
  'markinganonymous',
  'requiresubmissionstatement',
  'preventsubmissionnotingroup',
  'submissionattachments',
  'configs',
  'introfiles',
]);

/** An assignment with its intro as Markdown and without its settings. */
export function pickAssignments(result: unknown): unknown {
  return mapList(result, 'courses', (course) =>
    mapList(course, 'assignments', (assignment) => withBriefIntro(omit(assignment, ASSIGNMENT_NOISE), 2000)),
  );
}

/** Settings of a forum (grading, RSS, blocking, tracking) that a reader of the forum never uses. */
const FORUM_NOISE = new Set([
  'introfiles',
  'duedate',
  'cutoffdate',
  'assessed',
  'assesstimestart',
  'assesstimefinish',
  'scale',
  'grade_forum',
  'grade_forum_notify',
  'maxbytes',
  'maxattachments',
  'forcesubscribe',
  'trackingtype',
  'rsstype',
  'rssarticles',
  'warnafter',
  'blockafter',
  'blockperiod',
  'completiondiscussions',
  'completionreplies',
  'completionposts',
  'cancreatediscussions',
  'lockdiscussionafter',
  'istracked',
]);

export const pickForums = (result: unknown): unknown =>
  Array.isArray(result) ? result.map((forum) => withBriefIntro(omit(forum, FORUM_NOISE), 500)) : result;

/**
 * Of a notification: the message once (`fullmessage` is the text of `fullmessagehtml`, `text` and `smallmessage`
 * are its subject again), and not the icon, the relative time or the recipient.
 */
const NOTIFICATION_NOISE = new Set([
  'text',
  'smallmessage',
  'shortenedsubject',
  'fullmessagehtml',
  'useridto',
  'deleted',
  'timecreatedpretty',
  'iconurl',
]);

export const pickNotifications = (result: unknown): unknown =>
  mapList(result, 'notifications', (notification) => omit(notification, NOTIFICATION_NOISE));

/** The same value without the listed keys at any depth, for results whose useful fields are the many. */
function omitDeep(value: unknown, fields: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => omitDeep(item, fields));
  if (!isFields(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !fields.has(key))
      .map(([key, item]) => [key, omitDeep(item, fields)] as const),
  );
}

const noise = (...fields: string[]) => new Set(fields);

const SEARCH_COURSE_NOISE = noise(
  'displayname',
  'categoryid',
  'sortorder',
  'courseimage',
  'summaryfiles',
  'overviewfiles',
  'enrollmentmethods',
  'showactivitydates',
  'showcompletionconditions',
);

/** Found courses: names, ids, teachers and a short summary, without pictures and display settings. */
export function pickSearchedCourses(result: unknown): unknown {
  return mapList(result, 'courses', (course) => {
    const kept = omit(course, SEARCH_COURSE_NOISE);
    return isFields(kept) && typeof kept.summary === 'string'
      ? { ...kept, summary: shortMarkdown(kept.summary, 300) }
      : kept;
  });
}

const POST_NOISE = noise(
  'capabilities',
  'html',
  'urls',
  'haswordcount',
  'wordcount',
  'charcount',
  'isprivatereply',
  'hasparent',
);

/** Forum posts without the permission flags, rendered fragments and action links Moodle attaches to each. */
export const pickForumPosts = (result: unknown): unknown => omitDeep(result, POST_NOISE);

const DISCUSSION_NOISE = noise(
  'parent',
  'mailed',
  'messagetrust',
  'totalscore',
  'mailnow',
  'canreply',
  'canlock',
  'canfavourite',
);

/** A topic list shows a preview of each message; get_forum_posts has the whole text. */
export function pickForumDiscussions(result: unknown): unknown {
  return mapList(result, 'discussions', (discussion) => {
    const kept = omit(discussion, DISCUSSION_NOISE);
    return isFields(kept) && 'message' in kept ? { ...kept, message: briefHtml(kept.message, 600) } : kept;
  });
}

const GLOSSARY_NOISE = noise(
  'usedynalink',
  'casesensitive',
  'fullmatch',
  'approved',
  'canviewfullnames',
  'sourceglossaryid',
);

export const pickGlossaryEntries = (result: unknown): unknown => omitDeep(result, GLOSSARY_NOISE);

const LESSON_NOISE = noise('filescount', 'filessizetotal', 'answerids', 'qoption', 'layout', 'display');

export const pickLessonPages = (result: unknown): unknown => omitDeep(result, LESSON_NOISE);

const SUBMISSION_NOISE = noise('usergroups', 'caneditowner', 'blindmarking');

export const pickSubmissionStatus = (result: unknown): unknown => omitDeep(result, SUBMISSION_NOISE);

const ATTEMPT_NOISE = noise(
  'layout',
  'uniqueid',
  'currentpage',
  'preview',
  'timemodifiedoffline',
  'timecheckstate',
  'gradednotificationsenttime',
);

export const pickQuizAttempts = (result: unknown): unknown => omitDeep(result, ATTEMPT_NOISE);

const REVIEW_NOISE = noise(
  ...ATTEMPT_NOISE,
  'sequencecheck',
  'lastactiontime',
  'hasautosavedstep',
  'settings',
);

export const pickQuizReview = (result: unknown): unknown => omitDeep(result, REVIEW_NOISE);

const QUIZ_FIELDS = [
  'id',
  'coursemodule',
  'course',
  'name',
  'timeopen',
  'timeclose',
  'timelimit',
  'attempts',
  'grademethod',
  'grade',
  'sumgrades',
  'hasquestions',
  'section',
  'visible',
] as const;

/** A quiz as a student asks about it: when, how long, how many tries, how graded. The rest are 40 or so settings. */
export function pickQuizzes(result: unknown): unknown {
  return mapList(result, 'quizzes', (quiz) => ({
    ...pick(quiz, QUIZ_FIELDS),
    ...(isFields(quiz) && 'intro' in quiz ? { intro: briefHtml(quiz.intro) } : {}),
  }));
}

const EVENT_FIELDS = [
  'id',
  'name',
  'eventtype',
  'modulename',
  'instance',
  'timestart',
  'timeduration',
  'overdue',
  'viewurl',
] as const;

/** An event without its icon, edit links, formatted copies of its time and the whole course record it sits in. */
function pickEvent(event: unknown): unknown {
  if (!isFields(event)) return event;
  const { course, action, description } = event;
  return {
    ...pick(event, EVENT_FIELDS),
    ...(description === undefined ? {} : { description: briefHtml(description, 500) }),
    ...(isFields(course) ? { course: pick(course, ['id', 'fullname', 'shortname']) } : {}),
    ...(isFields(action) ? { action: pick(action, ['name', 'url', 'actionable']) } : {}),
  };
}

/** The `events` of a calendar result (`get_course_events`, `get_upcoming_events`), each as {@link pickEvent}. */
export const pickEvents = (result: unknown): unknown => mapList(result, 'events', pickEvent);

const GRADE_FIELDS = [
  'id',
  'itemname',
  'itemtype',
  'itemmodule',
  'iteminstance',
  'cmid',
  'categoryid',
  'graderaw',
  'gradeformatted',
  'grademin',
  'grademax',
  'percentageformatted',
  'rangeformatted',
  'weightformatted',
  'rank',
  'numusers',
  'averageformatted',
  'gradedategraded',
  'gradeishidden',
] as const;

/** A grade item with the grade, its range, weight and the class average; feedback as short Markdown. */
function pickGradeItem(item: unknown): unknown {
  return {
    ...pick(item, GRADE_FIELDS),
    ...(isFields(item) && 'feedback' in item ? { feedback: briefHtml(item.feedback, 500) } : {}),
  };
}

/** The grade items inside each user's grades of `gradereport_user_get_grade_items`. */
export const pickGrades = (result: unknown): unknown =>
  mapList(result, 'usergrades', (grades) =>
    isFields(grades) ? mapList(grades, 'gradeitems', pickGradeItem) : grades,
  );

/** One rule behind a completion state as a line of text: its name, then what it says ("Done: View"). */
function ruleLine(detail: unknown): string {
  if (!isFields(detail)) return '';
  const value = isFields(detail.rulevalue) ? detail.rulevalue : {};
  return [detail.rulename, value.description]
    .filter((part) => typeof part === 'string' && part !== '')
    .join(': ');
}

/** One activity's completion: its state and the rules behind it as short lines. */
function pickStatus(status: unknown): unknown {
  if (!isFields(status)) return status;
  const rules = (Array.isArray(status.details) ? status.details : [])
    .map(ruleLine)
    .filter((line) => line !== '');
  return {
    ...pick(status, ['cmid', 'modname', 'instance', 'state', 'timecompleted', 'tracking', 'overrideby']),
    ...(rules.length > 0 ? { rules } : {}),
  };
}

/** The `statuses` of `core_completion_get_activities_completion_status`. */
export const pickCompletion = (result: unknown): unknown => mapList(result, 'statuses', pickStatus);

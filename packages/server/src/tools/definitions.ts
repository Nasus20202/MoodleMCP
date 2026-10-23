import * as z from 'zod/v4';

import { MoodleFunction } from '../moodle/functions.ts';
import { getPageTool, listActivitiesTool } from './activities.ts';
import { defineTool } from './define.ts';
import { ToolName } from './names.ts';
import {
  getConversationMessagesTool,
  getCourseParticipantsTool,
  getUserProfileTool,
  listConversationsTool,
} from './people.ts';
import { readFileTool } from './read-file.ts';
import { pickSiteInfo } from './tidy.ts';

const id = (describe: string) => z.number().int().positive().describe(describe);
const courseId = id('Moodle course id: the `id` of a course from list_courses or search_courses');
const forumId = id('forum id: the `id` of a forum from list_forums');
const noInput = z.object({});
const courseInput = z.object({ course_id: courseId });

/** Many Moodle functions take an array parameter, which its REST protocol spells `name[0]=…`. */
const courseIds = ({ course_id }: z.output<typeof courseInput>) => ({ 'courseids[0]': course_id });

/** Appended to descriptions of tools whose output has timestamps; models otherwise misread them. */
const TIMES = 'All timestamps are Unix seconds.';

export const TOOLS = [
  defineTool({
    name: ToolName.GetSiteInfo,
    description:
      'Show which Moodle site this is and who is signed in (name, user id, Moodle version). Rarely needed: ' +
      'the other tools already know the user. Use it to check that the connection works.',
    input: noInput,
    fn: MoodleFunction.SiteInfo,
    params: () => ({}),
    shape: pickSiteInfo,
  }),
  defineTool({
    name: ToolName.ListCourses,
    description:
      'List the courses the user is enrolled in, with their ids: start here, because almost every other tool ' +
      'needs a `course_id` from this list.',
    input: noInput,
    fn: MoodleFunction.UserCourses,
    params: async (_, client) => ({ userid: await client.userId() }),
  }),
  defineTool({
    name: ToolName.SearchCourses,
    description:
      'Search ALL visible courses on the site by name, including ones the user is not enrolled in. To find ' +
      "one of the user's own courses, use list_courses instead. Each course lists its `contacts` (usually the " +
      'teachers) with their user ids; pass one to get_user_profile for an email address.',
    input: z.object({ query: z.string().min(1).describe('text to search for in course names') }),
    fn: MoodleFunction.SearchCourses,
    params: ({ query }) => ({ criterianame: 'search', criteriavalue: query }),
  }),
  defineTool({
    name: ToolName.GetCourseContents,
    description:
      'Show the full outline of a course: every section with its activities (files, pages, assignments, ' +
      'quizzes, forums, links, labels) in the order students see them. Files and folders list their ' +
      '`fileurl`; pass that value to read_file to read the document. Each activity has an `id` (cmid), a ' +
      '`modname` (type) and an `instance` id; the instance id is what list_assignments, list_forums, ' +
      'list_quizzes, etc. call `assign_id`/`forum_id`/`quiz_id`. This is the best first look at a course, ' +
      'but the output is large: prefer list_activities, list_assignments or list_quizzes when you only need one kind.',
    input: courseInput,
    fn: MoodleFunction.CourseContents,
    params: ({ course_id }) => ({ courseid: course_id }),
  }),
  defineTool({
    name: ToolName.GetCourseModule,
    description:
      'Look up one activity by its course-module id (cmid) and get its type (`modname`), course and ' +
      '`instance` id. Use this when the user gives a Moodle link such as `.../mod/assign/view.php?id=123`: the ' +
      '`id` in the link is the cmid. Then call the matching tool with the instance id.',
    input: z.object({
      cmid: id(
        'course-module id: the `id` in a Moodle activity link, or `id` of a module in get_course_contents',
      ),
    }),
    fn: MoodleFunction.CourseModule,
    params: ({ cmid }) => ({ cmid }),
  }),
  readFileTool,
  listActivitiesTool,
  getPageTool,
  defineTool({
    name: ToolName.GetGlossaryEntries,
    description:
      'Read the entries (term, definition, author) of a glossary, alphabetically. `glossary_id` is the `id` of ' +
      'a glossary from list_activities (type glossary). Entries awaiting approval are not shown. A long ' +
      'glossary comes back in parts: raise `offset` by `limit` to read on. ' +
      TIMES,
    input: z.object({
      glossary_id: id('glossary id: the `id` of a glossary from list_activities (type glossary)'),
      offset: z.number().int().min(0).default(0).describe('number of entries to skip'),
      limit: z.number().int().min(1).max(100).default(50).describe('most entries to return (default 50)'),
    }),
    fn: MoodleFunction.GlossaryEntries,
    params: ({ glossary_id, offset, limit }) => ({
      id: glossary_id,
      letter: 'ALL',
      from: offset,
      limit,
    }),
  }),
  defineTool({
    name: ToolName.GetLessonPages,
    description:
      'Read the pages of a lesson (their titles and content) in the order the teacher set. `lesson_id` is the ' +
      '`id` of a lesson from list_activities (type lesson). This only reads; it does not start an attempt.',
    input: z.object({ lesson_id: id('lesson id: the `id` of a lesson from list_activities (type lesson)') }),
    fn: MoodleFunction.LessonPages,
    params: ({ lesson_id }) => ({ lessonid: lesson_id }),
  }),
  defineTool({
    name: ToolName.GetChoiceResults,
    description:
      'Show the results of a choice (poll): each option and how many chose it, and who when the teacher ' +
      'made results public. `choice_id` is the `id` of a choice from list_activities (type choice).',
    input: z.object({ choice_id: id('choice id: the `id` of a choice from list_activities (type choice)') }),
    fn: MoodleFunction.ChoiceResults,
    params: ({ choice_id }) => ({ choiceid: choice_id }),
  }),
  defineTool({
    name: ToolName.GetFeedbackAnalysis,
    description:
      'Show the summarised answers to a feedback survey, when the teacher lets participants see them. ' +
      '`feedback_id` is the `id` of a feedback from list_activities (type feedback). Fails if the analysis ' +
      'is not available to students.',
    input: z.object({
      feedback_id: id('feedback id: the `id` of a feedback from list_activities (type feedback)'),
    }),
    fn: MoodleFunction.FeedbackAnalysis,
    params: ({ feedback_id }) => ({ feedbackid: feedback_id }),
  }),
  defineTool({
    name: ToolName.ListWikis,
    description:
      "List a course's wikis. Take a wiki's `id` and call get_wiki_pages to read its pages. Group wikis " +
      'appear once per accessible group or student.',
    input: courseInput,
    fn: MoodleFunction.Wikis,
    params: courseIds,
  }),
  defineTool({
    name: ToolName.GetWikiPages,
    description:
      'Read the pages of a wiki, including their HTML content (`cachedcontent`). `wiki_id` is the `id` of a wiki ' +
      'from list_wikis. ' +
      TIMES,
    input: z.object({ wiki_id: id('wiki id: the `id` of a wiki from list_wikis') }),
    fn: MoodleFunction.WikiPages,
    params: ({ wiki_id }) => ({ wikiid: wiki_id }),
  }),
  defineTool({
    name: ToolName.ListAssignments,
    description:
      "List a course's assignments with description, due date and attached files. Each assignment's `id` is the " +
      '`assign_id` for get_submission_status. Task files can be read with read_file. ' +
      TIMES,
    input: courseInput,
    fn: MoodleFunction.Assignments,
    params: courseIds,
  }),
  defineTool({
    name: ToolName.GetSubmissionStatus,
    description:
      "Show the signed-in user's own submission for an assignment: whether it was submitted, its grade and the " +
      "teacher's feedback. `assign_id` is the `id` of an assignment from list_assignments (not the cmid).",
    input: z.object({ assign_id: id('assignment id: the `id` of an assignment from list_assignments') }),
    fn: MoodleFunction.SubmissionStatus,
    params: ({ assign_id }) => ({ assignid: assign_id }),
  }),
  defineTool({
    name: ToolName.ListQuizzes,
    description:
      "List a course's quizzes with time limit, open/close dates, attempts allowed and grade settings. Each " +
      "quiz's `id` is the `quiz_id` for get_quiz_attempts. " +
      TIMES,
    input: courseInput,
    fn: MoodleFunction.Quizzes,
    params: courseIds,
  }),
  defineTool({
    name: ToolName.GetQuizAttempts,
    description:
      "List the signed-in user's own attempts at a quiz, with state, score and times. An attempt's `id` is the " +
      '`attempt_id` for get_quiz_attempt_review. Returns an empty list if the user has not tried it. ' +
      TIMES,
    input: z.object({ quiz_id: id('quiz id: the `id` of a quiz from list_quizzes') }),
    fn: MoodleFunction.QuizAttempts,
    params: async ({ quiz_id }, client) => ({
      quizid: quiz_id,
      userid: await client.userId(),
      status: 'all',
    }),
  }),
  defineTool({
    name: ToolName.GetQuizAttemptReview,
    description:
      "Review one of the user's finished quiz attempts: each question, the user's answer, and (when the quiz " +
      'allows it) the correct answer, marks and feedback. Fails if the teacher has not enabled review yet.',
    input: z.object({ attempt_id: id('attempt id: the `id` of a finished attempt from get_quiz_attempts') }),
    fn: MoodleFunction.QuizAttemptReview,
    params: ({ attempt_id }) => ({ attemptid: attempt_id, page: -1 }),
  }),
  defineTool({
    name: ToolName.GetUpcomingEvents,
    description:
      'Show what is coming up in the next weeks across ALL courses: assignment deadlines, quiz openings, ' +
      'classes and personal events. The best answer to "what is due soon?". For one course, use ' +
      'get_course_events. ' +
      TIMES,
    input: noInput,
    fn: MoodleFunction.UpcomingEvents,
    params: () => ({}),
  }),
  defineTool({
    name: ToolName.GetCourseEvents,
    description:
      'Show the actionable calendar events (deadlines, quiz and assignment dates) of ONE course, including ' +
      'whether each is still open. For everything across courses, use get_upcoming_events. ' +
      TIMES,
    input: courseInput,
    fn: MoodleFunction.CourseEvents,
    params: ({ course_id }) => ({ courseid: course_id }),
  }),
  defineTool({
    name: ToolName.GetCourseCompletion,
    description:
      "Show which of a course's activities the user has completed. Empty if the course does not track " +
      'completion.',
    input: courseInput,
    fn: MoodleFunction.CourseCompletion,
    params: async ({ course_id }, client) => ({ courseid: course_id, userid: await client.userId() }),
  }),
  defineTool({
    name: ToolName.GetGrades,
    description:
      "Show the user's grade for every item in one course (assignments, quizzes, totals) with feedback and " +
      'ranges. For the overall grade of every course at once, use get_grades_overview.',
    input: courseInput,
    fn: MoodleFunction.GradeItems,
    params: async ({ course_id }, client) => ({ courseid: course_id, userid: await client.userId() }),
  }),
  defineTool({
    name: ToolName.GetGradesOverview,
    description:
      "Show the user's overall grade in every enrolled course in one call. A `-` means no grade yet. For " +
      'the breakdown inside a course, use get_grades.',
    input: noInput,
    fn: MoodleFunction.CourseGrades,
    params: async (_, client) => ({ userid: await client.userId() }),
  }),
  defineTool({
    name: ToolName.ListForums,
    description:
      "List a course's forums (announcements, discussion boards). A forum's `id` is the `forum_id` for " +
      'list_forum_discussions.',
    input: courseInput,
    fn: MoodleFunction.Forums,
    params: courseIds,
  }),
  defineTool({
    name: ToolName.ListForumDiscussions,
    description:
      "List the discussion topics in a forum, newest first, with author, time and a preview. A topic's " +
      '`discussion` field is the `discussion_id` for get_forum_posts. Course announcements live in the ' +
      'forum named "Announcements"/"Ogłoszenia". ' +
      TIMES,
    input: z.object({ forum_id: forumId }),
    fn: MoodleFunction.ForumDiscussions,
    params: ({ forum_id }) => ({ forumid: forum_id }),
  }),
  defineTool({
    name: ToolName.GetForumPosts,
    description:
      'Read all posts of one forum discussion, oldest first, including the full message text and attachments ' +
      '(read them with read_file). `discussion_id` is the `discussion` field from list_forum_discussions. ' +
      TIMES,
    input: z.object({
      discussion_id: id('discussion id: the `discussion` field of a topic from list_forum_discussions'),
    }),
    fn: MoodleFunction.ForumPosts,
    params: ({ discussion_id }) => ({ discussionid: discussion_id, sortby: 'created', sortdirection: 'ASC' }),
  }),
  getCourseParticipantsTool,
  getUserProfileTool,
  listConversationsTool,
  getConversationMessagesTool,
  defineTool({
    name: ToolName.GetNotifications,
    description:
      "Show the user's recent Moodle notifications (new grades, forum replies, assignment feedback), newest " +
      'first.',
    input: noInput,
    fn: MoodleFunction.PopupNotifications,
    params: async (_, client) => ({ useridto: await client.userId() }),
  }),
];

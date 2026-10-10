import * as z from 'zod/v4';

import { MoodleFunction } from '../moodle/functions.ts';
import { defineTool } from './define.ts';
import { ToolName } from './names.ts';

const courseId = z.number().int().positive().describe('Moodle course id (from list_courses)');
const assignmentId = z.number().int().positive().describe('assignment instance id (from list_assignments)');
const forumId = z.number().int().positive().describe('forum instance id (from list_forums)');
const noInput = z.object({});
const courseInput = z.object({ course_id: courseId });

/** Many Moodle functions take an array parameter, which its REST protocol spells `name[0]=…`. */
const courseIds = ({ course_id }: z.output<typeof courseInput>) => ({ 'courseids[0]': course_id });

export const TOOLS = [
  defineTool({
    name: ToolName.GetSiteInfo,
    description: 'Show the Moodle site and the signed-in user (name, user id).',
    input: noInput,
    fn: MoodleFunction.SiteInfo,
    params: () => ({}),
  }),
  defineTool({
    name: ToolName.ListCourses,
    description: 'List courses the user is enrolled in.',
    input: noInput,
    fn: MoodleFunction.UserCourses,
    params: async (_, client) => ({ userid: await client.userId() }),
  }),
  defineTool({
    name: ToolName.SearchCourses,
    description: 'Search all visible courses on the site by name.',
    input: z.object({ query: z.string().min(1).describe('text to search for in course names') }),
    fn: MoodleFunction.SearchCourses,
    params: ({ query }) => ({ criterianame: 'search', criteriavalue: query }),
  }),
  defineTool({
    name: ToolName.GetCourseContents,
    description: "List a course's sections, activities and attached files.",
    input: courseInput,
    fn: MoodleFunction.CourseContents,
    params: ({ course_id }) => ({ courseid: course_id }),
  }),
  defineTool({
    name: ToolName.ListAssignments,
    description: 'List assignments of a course with due dates.',
    input: courseInput,
    fn: MoodleFunction.Assignments,
    params: courseIds,
  }),
  defineTool({
    name: ToolName.GetSubmissionStatus,
    description: "Show the user's submission and grading status for an assignment.",
    input: z.object({ assign_id: assignmentId }),
    fn: MoodleFunction.SubmissionStatus,
    params: ({ assign_id }) => ({ assignid: assign_id }),
  }),
  defineTool({
    name: ToolName.GetUpcomingEvents,
    description: 'Show upcoming calendar events (deadlines, classes).',
    input: noInput,
    fn: MoodleFunction.UpcomingEvents,
    params: () => ({}),
  }),
  defineTool({
    name: ToolName.GetGrades,
    description: "Show the user's grade items for a course.",
    input: courseInput,
    fn: MoodleFunction.GradeItems,
    params: async ({ course_id }, client) => ({ courseid: course_id, userid: await client.userId() }),
  }),
  defineTool({
    name: ToolName.ListForums,
    description: 'List forums of a course.',
    input: courseInput,
    fn: MoodleFunction.Forums,
    params: courseIds,
  }),
  defineTool({
    name: ToolName.ListForumDiscussions,
    description: 'List discussions in a forum.',
    input: z.object({ forum_id: forumId }),
    fn: MoodleFunction.ForumDiscussions,
    params: ({ forum_id }) => ({ forumid: forum_id }),
  }),
  defineTool({
    name: ToolName.ListPages,
    description: "List 'Page' resources of a course including their HTML content.",
    input: courseInput,
    fn: MoodleFunction.Pages,
    params: courseIds,
  }),
  defineTool({
    name: ToolName.GetNotifications,
    description: "Show the user's recent Moodle notifications.",
    input: noInput,
    fn: MoodleFunction.PopupNotifications,
    params: async (_, client) => ({ useridto: await client.userId() }),
  }),
];

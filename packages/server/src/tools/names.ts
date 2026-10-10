/** Identifies an MCP tool. These are the names agents see. */
export const ToolName = {
  GetSiteInfo: 'get_site_info',
  ListCourses: 'list_courses',
  SearchCourses: 'search_courses',
  GetCourseContents: 'get_course_contents',
  ListAssignments: 'list_assignments',
  GetSubmissionStatus: 'get_submission_status',
  GetUpcomingEvents: 'get_upcoming_events',
  GetGrades: 'get_grades',
  ListForums: 'list_forums',
  ListForumDiscussions: 'list_forum_discussions',
  ListPages: 'list_pages',
  GetNotifications: 'get_notifications',
} as const;
export type ToolName = (typeof ToolName)[keyof typeof ToolName];

/**
 * The Moodle web service functions this server may call. All of them are read-only; the client
 * refuses anything not listed here.
 */
export const MoodleFunction = {
  SiteInfo: 'core_webservice_get_site_info',
  UserCourses: 'core_enrol_get_users_courses',
  CourseContents: 'core_course_get_contents',
  SearchCourses: 'core_course_search_courses',
  Assignments: 'mod_assign_get_assignments',
  SubmissionStatus: 'mod_assign_get_submission_status',
  UpcomingEvents: 'core_calendar_get_calendar_upcoming_view',
  GradeItems: 'gradereport_user_get_grade_items',
  Forums: 'mod_forum_get_forums_by_courses',
  ForumDiscussions: 'mod_forum_get_forum_discussions',
  Pages: 'mod_page_get_pages_by_courses',
  PopupNotifications: 'message_popup_get_popup_notifications',
} as const;
export type MoodleFunction = (typeof MoodleFunction)[keyof typeof MoodleFunction];

const ALLOWED: ReadonlySet<string> = new Set(Object.values(MoodleFunction));

export const isAllowedFunction = (name: string): name is MoodleFunction => ALLOWED.has(name);

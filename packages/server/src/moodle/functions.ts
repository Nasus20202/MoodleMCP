/**
 * The Moodle web service functions this server may call. All of them are read-only; the client
 * refuses anything not listed here.
 */
export const MoodleFunction = {
  SiteInfo: 'core_webservice_get_site_info',
  UserCourses: 'core_enrol_get_users_courses',
  CourseContents: 'core_course_get_contents',
  CourseModule: 'core_course_get_course_module',
  SearchCourses: 'core_course_search_courses',
  CourseCompletion: 'core_completion_get_activities_completion_status',
  Assignments: 'mod_assign_get_assignments',
  SubmissionStatus: 'mod_assign_get_submission_status',
  UpcomingEvents: 'core_calendar_get_calendar_upcoming_view',
  CourseEvents: 'core_calendar_get_action_events_by_course',
  GradeItems: 'gradereport_user_get_grade_items',
  CourseGrades: 'gradereport_overview_get_course_grades',
  Forums: 'mod_forum_get_forums_by_courses',
  ForumDiscussions: 'mod_forum_get_forum_discussions',
  ForumPosts: 'mod_forum_get_discussion_posts',
  Pages: 'mod_page_get_pages_by_courses',
  Glossaries: 'mod_glossary_get_glossaries_by_courses',
  GlossaryEntries: 'mod_glossary_get_entries_by_letter',
  Lessons: 'mod_lesson_get_lessons_by_courses',
  LessonPages: 'mod_lesson_get_pages',
  Choices: 'mod_choice_get_choices_by_courses',
  ChoiceResults: 'mod_choice_get_choice_results',
  Feedbacks: 'mod_feedback_get_feedbacks_by_courses',
  FeedbackAnalysis: 'mod_feedback_get_analysis',
  EnrolledUsers: 'core_enrol_get_enrolled_users',
  UsersByField: 'core_user_get_users_by_field',
  Conversations: 'core_message_get_conversations',
  ConversationMessages: 'core_message_get_conversation_messages',
  Resources: 'mod_resource_get_resources_by_courses',
  Urls: 'mod_url_get_urls_by_courses',
  Labels: 'mod_label_get_labels_by_courses',
  Wikis: 'mod_wiki_get_wikis_by_courses',
  WikiPages: 'mod_wiki_get_subwiki_pages',
  Quizzes: 'mod_quiz_get_quizzes_by_courses',
  QuizAttempts: 'mod_quiz_get_user_attempts',
  QuizAttemptReview: 'mod_quiz_get_attempt_review',
  PopupNotifications: 'message_popup_get_popup_notifications',
} as const;
export type MoodleFunction = (typeof MoodleFunction)[keyof typeof MoodleFunction];

const ALLOWED: ReadonlySet<string> = new Set(Object.values(MoodleFunction));

export const isAllowedFunction = (name: string): name is MoodleFunction => ALLOWED.has(name);

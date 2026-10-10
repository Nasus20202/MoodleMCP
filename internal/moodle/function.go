package moodle

// Function is the name of a Moodle web service function.
// Only the read-only functions declared here can ever be called.
type Function string

const (
	SiteInfo           Function = "core_webservice_get_site_info"
	UserCourses        Function = "core_enrol_get_users_courses"
	CourseContents     Function = "core_course_get_contents"
	SearchCourses      Function = "core_course_search_courses"
	Assignments        Function = "mod_assign_get_assignments"
	SubmissionStatus   Function = "mod_assign_get_submission_status"
	UpcomingEvents     Function = "core_calendar_get_calendar_upcoming_view"
	GradeItems         Function = "gradereport_user_get_grade_items"
	Forums             Function = "mod_forum_get_forums_by_courses"
	ForumDiscussions   Function = "mod_forum_get_forum_discussions"
	Pages              Function = "mod_page_get_pages_by_courses"
	PopupNotifications Function = "message_popup_get_popup_notifications"
)

// Valid reports whether f is one of the allow-listed read-only functions.
func (f Function) Valid() bool {
	switch f {
	case SiteInfo, UserCourses, CourseContents, SearchCourses, Assignments, SubmissionStatus,
		UpcomingEvents, GradeItems, Forums, ForumDiscussions, Pages, PopupNotifications:
		return true
	}
	return false
}

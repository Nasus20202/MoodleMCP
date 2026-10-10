package tools

// Name identifies an MCP tool.
type Name string

const (
	GetSiteInfo          Name = "get_site_info"
	ListCourses          Name = "list_courses"
	SearchCourses        Name = "search_courses"
	GetCourseContents    Name = "get_course_contents"
	ListAssignments      Name = "list_assignments"
	GetSubmissionStatus  Name = "get_submission_status"
	GetUpcomingEvents    Name = "get_upcoming_events"
	GetGrades            Name = "get_grades"
	ListForums           Name = "list_forums"
	ListForumDiscussions Name = "list_forum_discussions"
	ListPages            Name = "list_pages"
	GetNotifications     Name = "get_notifications"
)

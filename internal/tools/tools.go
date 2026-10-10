// Package tools defines the read-only Moodle MCP tools.
package tools

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/url"
	"strconv"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/nasus/moodle-mcp/internal/moodle"
)

// Tool inputs. Field names are the argument names clients see.
type (
	noInput     struct{}
	searchInput struct {
		Query string `json:"query" jsonschema:"text to search for in course names"`
	}
	courseInput struct {
		CourseID int `json:"course_id" jsonschema:"Moodle course id (from list_courses)"`
	}
	assignInput struct {
		AssignID int `json:"assign_id" jsonschema:"assignment instance id (from list_assignments)"`
	}
	forumInput struct {
		ForumID int `json:"forum_id" jsonschema:"forum instance id (from list_forums)"`
	}
)

// spec describes one tool: which Moodle function it wraps and how its input maps to parameters.
type spec[In any] struct {
	name      Name
	desc      string
	fn        moodle.Function
	needsUser bool // resolve the token owner's user id first and pass it to params
	params    func(in In, userID int) url.Values
}

func (sp spec[In]) register(s *mcp.Server, c *moodle.Client, log *slog.Logger) {
	annotations := &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: new(false)}
	mcp.AddTool(s, &mcp.Tool{Name: string(sp.name), Description: sp.desc, Annotations: annotations},
		func(ctx context.Context, _ *mcp.CallToolRequest, in In) (*mcp.CallToolResult, any, error) {
			start := time.Now()
			out, err := sp.run(ctx, c, in)
			log.InfoContext(ctx, "tool call", "tool", string(sp.name), "ok", err == nil, "ms", time.Since(start).Milliseconds())
			if err != nil {
				// Surface the failure to the model as a tool error rather than a protocol error.
				return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}}}, nil, nil
			}
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(out)}}}, nil, nil
		})
}

func (sp spec[In]) run(ctx context.Context, c *moodle.Client, in In) (json.RawMessage, error) {
	var uid int
	if sp.needsUser {
		var err error
		if uid, err = c.UserID(ctx); err != nil {
			return nil, err
		}
	}
	var params url.Values
	if sp.params != nil {
		params = sp.params(in, uid)
	}
	var out json.RawMessage
	if err := c.Call(ctx, sp.fn, params, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func itoa(i int) string { return strconv.Itoa(i) }

// New builds an MCP server whose tools act on behalf of c. A nil logger disables logging.
func New(c *moodle.Client, log *slog.Logger) *mcp.Server {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	s := mcp.NewServer(&mcp.Implementation{Name: "moodle-mcp", Version: "0.1.0"}, nil)

	spec[noInput]{name: GetSiteInfo, desc: "Show the Moodle site and the signed-in user (name, user id).",
		fn: moodle.SiteInfo}.register(s, c, log)
	spec[noInput]{name: ListCourses, desc: "List courses the user is enrolled in.",
		fn: moodle.UserCourses, needsUser: true,
		params: func(_ noInput, uid int) url.Values { return url.Values{"userid": {itoa(uid)}} }}.register(s, c, log)
	spec[searchInput]{name: SearchCourses, desc: "Search all visible courses on the site by name.",
		fn: moodle.SearchCourses,
		params: func(in searchInput, _ int) url.Values {
			return url.Values{"criterianame": {"search"}, "criteriavalue": {in.Query}}
		}}.register(s, c, log)
	spec[courseInput]{name: GetCourseContents, desc: "List a course's sections, activities and attached files.",
		fn:     moodle.CourseContents,
		params: func(in courseInput, _ int) url.Values { return url.Values{"courseid": {itoa(in.CourseID)}} }}.register(s, c, log)
	spec[courseInput]{name: ListAssignments, desc: "List assignments of a course with due dates.",
		fn: moodle.Assignments, params: courseIDs}.register(s, c, log)
	spec[assignInput]{name: GetSubmissionStatus, desc: "Show the user's submission and grading status for an assignment.",
		fn:     moodle.SubmissionStatus,
		params: func(in assignInput, _ int) url.Values { return url.Values{"assignid": {itoa(in.AssignID)}} }}.register(s, c, log)
	spec[noInput]{name: GetUpcomingEvents, desc: "Show upcoming calendar events (deadlines, classes).",
		fn: moodle.UpcomingEvents}.register(s, c, log)
	spec[courseInput]{name: GetGrades, desc: "Show the user's grade items for a course.",
		fn: moodle.GradeItems, needsUser: true,
		params: func(in courseInput, uid int) url.Values {
			return url.Values{"courseid": {itoa(in.CourseID)}, "userid": {itoa(uid)}}
		}}.register(s, c, log)
	spec[courseInput]{name: ListForums, desc: "List forums of a course.",
		fn: moodle.Forums, params: courseIDs}.register(s, c, log)
	spec[forumInput]{name: ListForumDiscussions, desc: "List discussions in a forum.",
		fn:     moodle.ForumDiscussions,
		params: func(in forumInput, _ int) url.Values { return url.Values{"forumid": {itoa(in.ForumID)}} }}.register(s, c, log)
	spec[courseInput]{name: ListPages, desc: "List 'Page' resources of a course including their HTML content.",
		fn: moodle.Pages, params: courseIDs}.register(s, c, log)
	spec[noInput]{name: GetNotifications, desc: "Show the user's recent Moodle notifications.",
		fn: moodle.PopupNotifications, needsUser: true,
		params: func(_ noInput, uid int) url.Values { return url.Values{"useridto": {itoa(uid)}} }}.register(s, c, log)

	return s
}

// courseIDs maps a course input to the "courseids[]" array parameter many Moodle functions take.
func courseIDs(in courseInput, _ int) url.Values {
	return url.Values{"courseids[0]": {itoa(in.CourseID)}}
}

package tools

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/nasus/moodle-mcp/internal/moodle"
)

// fakeMoodle records web service calls and answers per function name.
type fakeMoodle struct {
	mu    sync.Mutex
	calls []url.Values
	reply map[string]string
}

func (f *fakeMoodle) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	r.ParseForm()
	f.mu.Lock()
	f.calls = append(f.calls, r.PostForm)
	f.mu.Unlock()
	if body, ok := f.reply[r.PostForm.Get("wsfunction")]; ok {
		w.Write([]byte(body))
		return
	}
	w.Write([]byte(`{"exception":"e","errorcode":"nofake","message":"no fake reply"}`))
}

func connect(t *testing.T, f *fakeMoodle) *mcp.ClientSession {
	t.Helper()
	ts := httptest.NewServer(f)
	t.Cleanup(ts.Close)
	srv := New(moodle.New(ts.URL, "tok", moodle.Options{}), nil)

	ct, st := mcp.NewInMemoryTransports()
	ctx := context.Background()
	ss, err := srv.Connect(ctx, st, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ss.Close() })
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "test"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cs.Close() })
	return cs
}

func text(t *testing.T, r *mcp.CallToolResult) string {
	t.Helper()
	if len(r.Content) != 1 {
		t.Fatalf("want 1 content item, got %d", len(r.Content))
	}
	return r.Content[0].(*mcp.TextContent).Text
}

func TestAllToolsListedAndReadOnly(t *testing.T) {
	cs := connect(t, &fakeMoodle{})
	res, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []Name{GetSiteInfo, ListCourses, SearchCourses, GetCourseContents, ListAssignments,
		GetSubmissionStatus, GetUpcomingEvents, GetGrades, ListForums, ListForumDiscussions, ListPages, GetNotifications}
	var got []string
	for _, tool := range res.Tools {
		got = append(got, tool.Name)
		if tool.Annotations == nil || !tool.Annotations.ReadOnlyHint {
			t.Errorf("%s is not marked read-only", tool.Name)
		}
	}
	for _, n := range want {
		if !slices.Contains(got, string(n)) {
			t.Errorf("tool %s missing", n)
		}
	}
	if len(got) != len(want) {
		t.Errorf("got %d tools, want %d: %v", len(got), len(want), got)
	}
}

func TestToolParams(t *testing.T) {
	f := &fakeMoodle{reply: map[string]string{
		"core_webservice_get_site_info":    `{"userid":9}`,
		"core_enrol_get_users_courses":     `[{"id":5}]`,
		"gradereport_user_get_grade_items": `{"usergrades":[]}`,
		"mod_assign_get_assignments":       `{"courses":[]}`,
	}}
	cs := connect(t, f)
	ctx := context.Background()

	res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: string(ListCourses)})
	if err != nil || res.IsError {
		t.Fatalf("err=%v res=%+v", err, res)
	}
	if got := text(t, res); got != `[{"id":5}]` {
		t.Errorf("result passthrough broken: %s", got)
	}
	last := f.calls[len(f.calls)-1]
	if last.Get("wsfunction") != "core_enrol_get_users_courses" || last.Get("userid") != "9" || last.Get("wstoken") != "tok" {
		t.Errorf("bad params: %v", last)
	}

	if _, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: string(GetGrades), Arguments: map[string]any{"course_id": 3}}); err != nil {
		t.Fatal(err)
	}
	last = f.calls[len(f.calls)-1]
	if last.Get("courseid") != "3" || last.Get("userid") != "9" {
		t.Errorf("grades params: %v", last)
	}

	if _, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: string(ListAssignments), Arguments: map[string]any{"course_id": 4}}); err != nil {
		t.Fatal(err)
	}
	if last = f.calls[len(f.calls)-1]; last.Get("courseids[0]") != "4" {
		t.Errorf("assignments params: %v", last)
	}
}

func TestMoodleErrorBecomesToolError(t *testing.T) {
	cs := connect(t, &fakeMoodle{}) // every function answers with an exception
	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: string(GetUpcomingEvents)})
	if err != nil {
		t.Fatal(err)
	}
	if !res.IsError || !strings.Contains(text(t, res), "nofake") {
		t.Errorf("want tool error mentioning nofake, got %+v", res)
	}
}

func TestMissingRequiredArgument(t *testing.T) {
	cs := connect(t, &fakeMoodle{})
	if res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: string(GetCourseContents)}); err == nil && !res.IsError {
		t.Error("calling without course_id should fail")
	}
}

package moodle

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestFunctionValid(t *testing.T) {
	for _, f := range []Function{SiteInfo, UserCourses, CourseContents, SearchCourses, Assignments,
		SubmissionStatus, UpcomingEvents, GradeItems, Forums, ForumDiscussions, Pages, PopupNotifications} {
		if !f.Valid() {
			t.Errorf("%s should be valid", f)
		}
	}
	for _, f := range []Function{"", "core_user_update_users", "mod_assign_save_submission"} {
		if f.Valid() {
			t.Errorf("%q must not be valid", f)
		}
	}
}

func TestCall(t *testing.T) {
	var got url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		got = r.PostForm
		if r.URL.Path != "/webservice/rest/server.php" || !strings.Contains(r.UserAgent(), "MoodleMobile") {
			t.Errorf("unexpected request %s ua=%q", r.URL.Path, r.UserAgent())
		}
		w.Write([]byte(`{"ok":1}`))
	}))
	defer srv.Close()

	c := New(srv.URL+"/", "tok", Options{})
	var out struct{ OK int }
	if err := c.Call(context.Background(), SiteInfo, url.Values{"a": {"b"}}, &out); err != nil {
		t.Fatal(err)
	}
	if out.OK != 1 || got.Get("wstoken") != "tok" || got.Get("wsfunction") != string(SiteInfo) ||
		got.Get("moodlewsrestformat") != "json" || got.Get("a") != "b" {
		t.Errorf("out=%+v form=%v", out, got)
	}
}

func TestCallErrors(t *testing.T) {
	status, body := 200, `{"exception":"x","errorcode":"invalidtoken","message":"bad"}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		w.Write([]byte(body))
	}))
	defer srv.Close()
	c := New(srv.URL, "t", Options{})

	var me *Error
	if err := c.Call(context.Background(), SiteInfo, nil, nil); !errors.As(err, &me) || me.Code != "invalidtoken" {
		t.Errorf("want moodle error, got %v", err)
	}
	status = 404
	if err := c.Call(context.Background(), SiteInfo, nil, nil); err == nil || !strings.Contains(err.Error(), "404") {
		t.Errorf("want HTTP 404 error, got %v", err)
	}
	if err := c.Call(context.Background(), "core_user_update_users", nil, nil); !errors.Is(err, ErrNotAllowed) {
		t.Errorf("want ErrNotAllowed, got %v", err)
	}
}

func TestUserIDCached(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Write([]byte(`{"userid":42}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "t", Options{})
	for range 3 {
		if id, err := c.UserID(context.Background()); err != nil || id != 42 {
			t.Fatalf("id=%d err=%v", id, err)
		}
	}
	if calls != 1 {
		t.Errorf("want 1 upstream call, got %d", calls)
	}
}

func TestParseQRLogin(t *testing.T) {
	q, err := ParseQRLogin("moodlemobile://https://x.example/2025?qrlogin=AbC_1&userid=7")
	if err != nil || q.Site != "https://x.example/2025" || q.Key != "AbC_1" || q.UserID != 7 {
		t.Errorf("got %+v, %v", q, err)
	}
	for _, bad := range []string{"", "moodlemobile://https://x.example", "moodlemobile://https://x.example?qrlogin=a", "::"} {
		if _, err := ParseQRLogin(bad); err == nil {
			t.Errorf("%q should fail", bad)
		}
	}
}

func TestExchange(t *testing.T) {
	reply := `[{"error":false,"data":{"token":"secret","privatetoken":"p"}}]`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/lib/ajax/service-nologin.php" || !strings.Contains(r.UserAgent(), "MoodleMobile") {
			t.Errorf("bad request %s %q", r.URL.Path, r.UserAgent())
		}
		w.Write([]byte(reply))
	}))
	defer srv.Close()
	q := QRLogin{Site: srv.URL, Key: "k", UserID: 1}

	if tok, err := q.Exchange(context.Background(), http.DefaultClient); err != nil || tok != "secret" {
		t.Errorf("tok=%q err=%v", tok, err)
	}
	reply = `[{"error":true,"exception":{"errorcode":"qrcodedisabled","message":"off"}}]`
	var me *Error
	if _, err := q.Exchange(context.Background(), http.DefaultClient); !errors.As(err, &me) || me.Code != "qrcodedisabled" {
		t.Errorf("want qrcodedisabled, got %v", err)
	}
	reply = `garbage`
	if _, err := q.Exchange(context.Background(), http.DefaultClient); err == nil {
		t.Error("want error on garbage")
	}
}

func TestDecodeLaunchToken(t *testing.T) {
	enc := base64.StdEncoding.EncodeToString([]byte("site:::thetoken:::private"))
	for _, in := range []string{"moodlemobile://token=" + enc, "moodlemobile://token=" + url.QueryEscape(enc), "token=" + strings.TrimRight(enc, "=")} {
		if tok, err := DecodeLaunchToken(in); err != nil || tok != "thetoken" {
			t.Errorf("%q -> %q, %v", in, tok, err)
		}
	}
	for _, bad := range []string{"", "moodlemobile://nothing", "moodlemobile://token=!!!", "moodlemobile://token=" + base64.StdEncoding.EncodeToString([]byte("nosep"))} {
		if _, err := DecodeLaunchToken(bad); err == nil {
			t.Errorf("%q should fail", bad)
		}
	}
}

func TestLaunchURL(t *testing.T) {
	got := LaunchURL("https://x.example/2025/", "abc")
	want := "https://x.example/2025/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=abc&urlscheme=moodlemobile&confirmed=1"
	if got != want {
		t.Errorf("got %s", got)
	}
}

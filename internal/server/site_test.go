package server

import (
	"net/http/httptest"
	"testing"
)

func TestSitePolicyValidate(t *testing.T) {
	const def = "https://moodle.example.edu/2025"
	tests := []struct {
		name    string
		cfg     Config
		raw     string
		want    string
		wantErr bool
	}{
		{"default host, other path", Config{MoodleURL: def}, "https://moodle.example.edu/moodle/", "https://moodle.example.edu/moodle", false},
		{"host match is case-insensitive", Config{MoodleURL: def}, "https://MOODLE.example.edu", "https://MOODLE.example.edu", false},
		{"other host refused by default", Config{MoodleURL: def}, "https://other.example.org", "", true},
		{"explicit allow-list", Config{MoodleURL: def, AllowedHosts: []string{"a.example.org", " b.example.org "}}, "https://b.example.org/x", "https://b.example.org/x", false},
		{"allow-list replaces the default host", Config{MoodleURL: def, AllowedHosts: []string{"a.example.org"}}, def, "", true},
		{"wildcard allows any public host", Config{MoodleURL: def, AllowedHosts: []string{"*"}}, "https://anything.example.org", "https://anything.example.org", false},
		{"http refused", Config{MoodleURL: def, AllowedHosts: []string{"*"}}, "http://anything.example.org", "", true},
		{"ip literal refused", Config{MoodleURL: def, AllowedHosts: []string{"*"}}, "https://10.0.0.1", "", true},
		{"localhost refused", Config{MoodleURL: def, AllowedHosts: []string{"*"}}, "https://localhost", "", true},
		{"single-label host refused", Config{MoodleURL: def, AllowedHosts: []string{"*"}}, "https://intranet", "", true},
		{"credentials refused", Config{MoodleURL: def, AllowedHosts: []string{"*"}}, "https://u:p@a.example.org", "", true},
		{"query refused", Config{MoodleURL: def, AllowedHosts: []string{"*"}}, "https://a.example.org/?x=1", "", true},
		{"garbage refused", Config{MoodleURL: def}, "::", "", true},
		{"insecure mode allows local http", Config{MoodleURL: "http://127.0.0.1:1", AllowInsecureSites: true}, "http://127.0.0.1:1/2025", "http://127.0.0.1:1/2025", false},
	}
	for _, tt := range tests {
		got, err := newSitePolicy(tt.cfg).validate(tt.raw)
		if (err != nil) != tt.wantErr || got != tt.want {
			t.Errorf("%s: got %q, %v; want %q (err=%v)", tt.name, got, err, tt.want, tt.wantErr)
		}
	}
}

func TestSitePolicyResolve(t *testing.T) {
	p := newSitePolicy(Config{MoodleURL: "https://moodle.example.edu/2025/"})

	r := httptest.NewRequest("POST", "/mcp", nil)
	if got, err := p.resolve(r); err != nil || got != "https://moodle.example.edu/2025" {
		t.Errorf("default: %q, %v", got, err)
	}
	r.Header.Set(SiteHeader, "https://moodle.example.edu/moodle")
	if got, err := p.resolve(r); err != nil || got != "https://moodle.example.edu/moodle" {
		t.Errorf("header: %q, %v", got, err)
	}
	r.Header.Set(SiteHeader, "https://evil.example.org")
	if _, err := p.resolve(r); err == nil {
		t.Error("disallowed header must fail")
	}
}

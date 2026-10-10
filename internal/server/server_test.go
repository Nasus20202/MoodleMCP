package server

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestToken(t *testing.T) {
	tests := []struct {
		name   string
		header map[string]string
		want   string
	}{
		{"bearer", map[string]string{"Authorization": "Bearer abc"}, "abc"},
		{"bearer case-insensitive", map[string]string{"Authorization": "bEaReR  abc "}, "abc"},
		{"x-moodle-token", map[string]string{"X-Moodle-Token": " xyz "}, "xyz"},
		{"basic is not a token", map[string]string{"Authorization": "Basic abc"}, ""},
		{"empty bearer", map[string]string{"Authorization": "Bearer "}, ""},
		{"none", nil, ""},
	}
	for _, tt := range tests {
		r := httptest.NewRequest("POST", "/mcp", nil)
		for k, v := range tt.header {
			r.Header.Set(k, v)
		}
		if got := Token(r); got != tt.want {
			t.Errorf("%s: got %q want %q", tt.name, got, tt.want)
		}
	}
}

func post(h http.Handler, token, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/mcp", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "application/json, text/event-stream")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestRequiresToken(t *testing.T) {
	h := Handler(Config{MoodleURL: "http://unused.invalid"})
	w := post(h, "", `{}`)
	if w.Code != http.StatusUnauthorized || w.Header().Get("WWW-Authenticate") == "" {
		t.Errorf("code=%d headers=%v", w.Code, w.Header())
	}
}

func TestServesToolsStatelessly(t *testing.T) {
	var logs bytes.Buffer
	h := Handler(Config{MoodleURL: "http://unused.invalid", Logger: slog.New(slog.NewJSONHandler(&logs, nil))})
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
	for range 2 { // no session needed, repeatable
		w := post(h, "secret-token", body)
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "get_site_info") {
			t.Fatalf("code=%d body=%s", w.Code, w.Body)
		}
	}
	if !strings.Contains(logs.String(), `"msg":"request"`) {
		t.Errorf("request not logged: %s", logs.String())
	}
	if strings.Contains(logs.String(), "secret-token") {
		t.Error("token leaked into logs")
	}
}

func TestToolsEndpoint(t *testing.T) {
	h := Handler(Config{MoodleURL: "http://unused.invalid"})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/tools", nil)) // no token needed
	if w.Code != http.StatusOK {
		t.Fatalf("code=%d", w.Code)
	}
	var res ToolsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil || len(res.Tools) != 12 {
		t.Fatalf("err=%v tools=%d", err, len(res.Tools))
	}
	for _, tool := range res.Tools {
		if !tool.ReadOnly || tool.Description == "" || tool.InputSchema == nil {
			t.Errorf("incomplete tool %+v", tool)
		}
	}
}

func TestExchangeEndpoint(t *testing.T) {
	moodleSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`[{"error":false,"data":{"token":"newtoken"}}]`))
	}))
	defer moodleSrv.Close()
	h := Handler(Config{MoodleURL: moodleSrv.URL + "/2025", AllowInsecureSites: true})

	do := func(qr string) *httptest.ResponseRecorder {
		b, _ := json.Marshal(ExchangeRequest{QR: qr})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", "/api/exchange", bytes.NewReader(b)))
		return w
	}
	if w := do("moodlemobile://" + moodleSrv.URL + "/2025?qrlogin=k&userid=1"); w.Code != 200 || !strings.Contains(w.Body.String(), "newtoken") {
		t.Errorf("good QR: %d %s", w.Code, w.Body)
	}
	if w := do("moodlemobile://https://evil.example/2025?qrlogin=k&userid=1"); w.Code != 400 || !strings.Contains(w.Body.String(), "not allowed") {
		t.Errorf("foreign site must be rejected, got %d %s", w.Code, w.Body)
	}
	if w := do("moodlemobile://" + moodleSrv.URL + "/2025"); w.Code != 400 {
		t.Errorf("URL-only QR must be rejected, got %d", w.Code)
	}
}

func TestConfigEndpoint(t *testing.T) {
	h := Handler(Config{MoodleURL: "https://moodle.example.edu/2025/"})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/config", nil))
	var res ConfigResponse
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil || res.MoodleURL != "https://moodle.example.edu/2025" {
		t.Errorf("err=%v res=%+v", err, res)
	}
}

func TestMCPRejectsDisallowedSiteHeader(t *testing.T) {
	h := Handler(Config{MoodleURL: "https://moodle.example.edu/2025"})
	r := httptest.NewRequest("POST", "/mcp", strings.NewReader(`{}`))
	r.Header.Set("Authorization", "Bearer t")
	r.Header.Set(SiteHeader, "https://evil.example.org")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), SiteHeader) {
		t.Errorf("code=%d body=%s", w.Code, w.Body)
	}
}

func TestMCPUsesSiteHeader(t *testing.T) {
	var hitPath string
	moodleSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hitPath = r.URL.Path
		w.Write([]byte(`{"userid":1}`))
	}))
	defer moodleSrv.Close()
	h := Handler(Config{MoodleURL: "https://default.example.edu", AllowedHosts: []string{"*"}, AllowInsecureSites: true})

	r := httptest.NewRequest("POST", "/mcp", strings.NewReader(
		`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_site_info","arguments":{}}}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "application/json, text/event-stream")
	r.Header.Set("Authorization", "Bearer t")
	r.Header.Set(SiteHeader, moodleSrv.URL+"/custom")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if hitPath != "/custom/webservice/rest/server.php" {
		t.Errorf("request went to %q (response %s)", hitPath, w.Body)
	}
}

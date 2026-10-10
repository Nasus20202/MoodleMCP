// Command moodle-mcp is a stateless, read-only MCP server for Moodle.
// It runs on Cloudflare Workers (GOOS=js GOARCH=wasm) or natively with `go run .`.
//
// Each request must carry the user's Moodle mobile web service token in
// "Authorization: Bearer <token>" (or "X-Moodle-Token"); nothing is stored server side.
package main

import (
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/syumai/workers-go"

	"github.com/nasus/moodle-mcp/internal/server"
)

const defaultMoodleURL = "https://enauczanie.pg.edu.pl/2025"

func main() {
	// Workers only expose env vars while a request is in flight, so build the handler lazily.
	var (
		once    sync.Once
		handler http.Handler
	)
	workers.Serve(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		once.Do(func() { handler = server.Handler(configFromEnv()) })
		handler.ServeHTTP(w, r)
	}))
}

func configFromEnv() server.Config {
	moodleURL := getenv("MOODLE_URL")
	if moodleURL == "" {
		moodleURL = defaultMoodleURL
	}
	level := slog.LevelInfo
	if getenv("LOG_LEVEL") == "debug" {
		level = slog.LevelDebug
	}
	log := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: level}))
	return server.Config{
		MoodleURL:    moodleURL,
		AllowedHosts: strings.Split(getenv("ALLOWED_MOODLE_HOSTS"), ","),
		HTTP:         httpClient(),
		Logger:       log,
	}
}

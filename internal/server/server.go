// Package server wires the MCP handler, token authentication, the web UI's API and request logging.
package server

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/nasus/moodle-mcp/internal/moodle"
	"github.com/nasus/moodle-mcp/internal/tools"
)

const bearerPrefix = "bearer "

// Token extracts the Moodle token from "Authorization: Bearer …" or "X-Moodle-Token".
func Token(r *http.Request) string {
	if h := r.Header.Get("Authorization"); len(h) > len(bearerPrefix) && strings.EqualFold(h[:len(bearerPrefix)], bearerPrefix) {
		return strings.TrimSpace(h[len(bearerPrefix):])
	}
	return strings.TrimSpace(r.Header.Get("X-Moodle-Token"))
}

// Handler serves the stateless MCP endpoint at /mcp, plus /api/* for the web UI.
// Every /mcp request must carry a Moodle token, and nothing is retained between requests.
func Handler(cfg Config) http.Handler {
	log := cfg.Logger
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	policy := newSitePolicy(cfg)

	mux := http.NewServeMux()
	mux.Handle("/mcp", withCredentials(policy, newMCPHandler(cfg, log)))
	mux.Handle("GET /api/config", handleConfig(policy))
	mux.Handle("GET /api/tools", handleTools(&catalog{}))
	mux.Handle("POST /api/exchange", handleExchange(cfg, policy, log))
	return logRequests(log, mux)
}

// newMCPHandler builds a fresh MCP server per request, bound to the caller's token and site.
func newMCPHandler(cfg Config, log *slog.Logger) http.Handler {
	return mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		creds, _ := credentialsFrom(r.Context())
		c := moodle.New(creds.Site, creds.Token, moodle.Options{HTTP: cfg.HTTP, Logger: log})
		return tools.New(c, log)
	}, &mcp.StreamableHTTPOptions{Stateless: true})
}

package server

import (
	"log/slog"
	"net/http"
)

// Config configures Handler.
type Config struct {
	MoodleURL string // default Moodle site, e.g. https://host/2025; callers may override it with SiteHeader
	// AllowedHosts lists the hosts callers may select via SiteHeader. Empty means only MoodleURL's host;
	// "*" means any public https host.
	AllowedHosts       []string
	AllowInsecureSites bool         // permit http and non-public hosts (tests and local development only)
	HTTP               *http.Client // outbound client; nil means http.DefaultClient
	Logger             *slog.Logger // nil disables logging
}

// ToolInfo describes one tool for the web UI; it mirrors the MCP tools/list entry.
type ToolInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	ReadOnly    bool   `json:"readOnly"`
	InputSchema any    `json:"inputSchema"`
}

// ToolsResponse is the body of GET /api/tools.
type ToolsResponse struct {
	Tools []ToolInfo `json:"tools"`
}

// ConfigResponse is the body of GET /api/config.
type ConfigResponse struct {
	MoodleURL string `json:"moodleUrl"`
}

// ExchangeRequest is the body of POST /api/exchange: the decoded text of a Moodle app QR code.
type ExchangeRequest struct {
	QR string `json:"qr"`
}

// ExchangeResponse is the success body of POST /api/exchange.
type ExchangeResponse struct {
	Token string `json:"token"`
}

// ErrorResponse is the body of every failed /api request.
type ErrorResponse struct {
	Error string `json:"error"`
}

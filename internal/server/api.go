package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/nasus/moodle-mcp/internal/moodle"
)

const maxExchangeBody = 4 << 10

// handleConfig tells the page which Moodle site is the default.
func handleConfig(policy sitePolicy) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, ConfigResponse{MoodleURL: policy.defaultURL})
	}
}

// handleTools serves the tool catalog. It needs no token, so the page can show it up front.
func handleTools(tools *catalog) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := tools.get(context.WithoutCancel(r.Context()))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "tool catalog unavailable")
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, ToolsResponse{Tools: list})
	}
}

// handleExchange trades the content of a Moodle app QR code for a token. Browsers cannot do this
// themselves because Moodle insists on a "MoodleMobile" user agent. Only the configured site is ever
// contacted (subject to the site policy), and the one-time key is neither stored nor logged.
func handleExchange(cfg Config, policy sitePolicy, log *slog.Logger) http.HandlerFunc {
	client := cfg.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var req ExchangeRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxExchangeBody)).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request")
			return
		}
		qr, err := moodle.ParseQRLogin(req.QR)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if _, err := policy.validate(qr.Site); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		token, err := qr.Exchange(r.Context(), client)
		log.InfoContext(r.Context(), "qr exchange", "ok", err == nil)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, ExchangeResponse{Token: token})
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, ErrorResponse{Error: msg})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

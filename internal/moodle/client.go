// Package moodle is a minimal read-only client for the Moodle web service REST API.
package moodle

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// UserAgent must contain "MoodleMobile" for Moodle to treat us as the official app,
// which is required for the QR login exchange.
const UserAgent = "MoodleMobile/4.5.0 (moodle-mcp)"

const maxResponseBytes = 16 << 20

// ErrNotAllowed is returned when asked to call a function that is not allow-listed.
var ErrNotAllowed = errors.New("moodle: function is not allow-listed")

// Error is a Moodle-side error returned inside an HTTP 200 response.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return fmt.Sprintf("moodle: %s: %s", e.Code, e.Message) }

// Client calls the web service on behalf of one token owner.
// It is cheap to create and not safe for concurrent use.
type Client struct {
	baseURL string
	token   string
	http    *http.Client
	log     *slog.Logger
	userID  int
}

// Options are optional client settings; the zero value is valid.
type Options struct {
	HTTP   *http.Client // default http.DefaultClient
	Logger *slog.Logger // default: discard
}

// New returns a client for the Moodle site at baseURL.
func New(baseURL, token string, o Options) *Client {
	if o.HTTP == nil {
		o.HTTP = http.DefaultClient
	}
	if o.Logger == nil {
		o.Logger = slog.New(slog.DiscardHandler)
	}
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), token: token, http: o.HTTP, log: o.Logger}
}

// Call invokes fn and decodes the JSON result into out (which may be nil).
func (c *Client) Call(ctx context.Context, fn Function, params url.Values, out any) (err error) {
	start := time.Now()
	defer func() {
		// Never log the token or parameter values; they may identify the user.
		attrs := []any{"function", string(fn), "ms", time.Since(start).Milliseconds()}
		if err != nil {
			c.log.WarnContext(ctx, "moodle call failed", append(attrs, "error", err.Error())...)
		} else {
			c.log.DebugContext(ctx, "moodle call", attrs...)
		}
	}()
	if !fn.Valid() {
		return fmt.Errorf("%w: %q", ErrNotAllowed, fn)
	}
	form := url.Values{}
	for k, v := range params {
		form[k] = v
	}
	form.Set("wstoken", c.token)
	form.Set("wsfunction", string(fn))
	form.Set("moodlewsrestformat", "json")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/webservice/rest/server.php", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", UserAgent)

	body, err := doJSON(c.http, req)
	if err != nil {
		return err
	}
	var probe wsException
	if json.Unmarshal(body, &probe) == nil && probe.Exception != "" {
		return &Error{Code: probe.ErrorCode, Message: probe.Message}
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(body, out)
}

// UserID returns the token owner's user id, looked up once per client.
func (c *Client) UserID(ctx context.Context) (int, error) {
	if c.userID == 0 {
		var info siteInfo
		if err := c.Call(ctx, SiteInfo, nil, &info); err != nil {
			return 0, err
		}
		c.userID = info.UserID
	}
	return c.userID, nil
}

func doJSON(h *http.Client, req *http.Request) ([]byte, error) {
	resp, err := h.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("moodle: HTTP %d", resp.StatusCode)
	}
	return body, nil
}

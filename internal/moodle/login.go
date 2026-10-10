package moodle

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// ParseQRLogin parses the decoded text of a Moodle app QR code.
func ParseQRLogin(s string) (QRLogin, error) {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "://"); i >= 0 && !strings.HasPrefix(s, "http") {
		s = s[i+3:] // strip moodlemobile:// (or a custom forced scheme)
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return QRLogin{}, errors.New("not a Moodle QR login URL")
	}
	q := u.Query()
	uid, _ := strconv.Atoi(q.Get("userid"))
	if q.Get("qrlogin") == "" || uid == 0 {
		return QRLogin{}, errors.New(`QR code has no login key; the site must use "QR code with automatic login"`)
	}
	u.RawQuery = ""
	return QRLogin{Site: u.String(), Key: q.Get("qrlogin"), UserID: uid}, nil
}

// qrMethod is the Moodle web service function behind QR login.
const qrMethod = "tool_mobile_get_tokens_for_qr_login"

// Exchange trades the (single use, short lived) QR key for a web service token.
func (q QRLogin) Exchange(ctx context.Context, h *http.Client) (string, error) {
	payload, err := json.Marshal([]ajaxCall{{
		MethodName: qrMethod,
		Args:       map[string]any{"qrloginkey": q.Key, "userid": q.UserID},
	}})
	if err != nil {
		return "", err
	}
	endpoint := strings.TrimRight(q.Site, "/") + "/lib/ajax/service-nologin.php?info=" + qrMethod
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", UserAgent)
	body, err := doJSON(h, req)
	if err != nil {
		return "", err
	}

	var results []ajaxResult[qrTokens]
	if err := json.Unmarshal(body, &results); err != nil || len(results) == 0 {
		return "", errors.New("unexpected response from Moodle")
	}
	switch r := results[0]; {
	case r.Exception != nil:
		return "", &Error{Code: r.Exception.ErrorCode, Message: r.Exception.Message}
	case r.Error || r.Data.Token == "":
		return "", errors.New("login failed")
	default:
		return r.Data.Token, nil
	}
}

// DecodeLaunchToken extracts the token from moodlemobile://token=BASE64(siteid:::token[:::privatetoken]),
// the link Moodle redirects to after a browser (SSO) login via admin/tool/mobile/launch.php.
func DecodeLaunchToken(s string) (string, error) {
	_, enc, ok := strings.Cut(s, "token=")
	if !ok {
		return "", errors.New("link should look like moodlemobile://token=…")
	}
	if u, err := url.QueryUnescape(enc); err == nil {
		enc = u
	}
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		raw, err = base64.RawStdEncoding.DecodeString(strings.TrimRight(enc, "="))
	}
	if err != nil {
		return "", errors.New("token link is not valid base64")
	}
	parts := strings.Split(string(raw), ":::")
	if len(parts) < 2 || parts[1] == "" {
		return "", fmt.Errorf("unexpected token payload")
	}
	return parts[1], nil
}

// LaunchURL is the page that starts a browser login. With confirmed=1 Moodle ends on a page whose
// "launch the app" link is moodlemobile://token=…; without it, Moodle sends a bare redirect that
// browsers cannot show.
func LaunchURL(site, passport string) string {
	return fmt.Sprintf("%s/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=%s&urlscheme=moodlemobile&confirmed=1",
		strings.TrimRight(site, "/"), url.QueryEscape(passport))
}

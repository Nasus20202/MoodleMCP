package server

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// SiteHeader lets a caller pick the Moodle site per request; it defaults to Config.MoodleURL.
const SiteHeader = "X-Moodle-URL"

// anyHost in Config.AllowedHosts permits every public https host.
const anyHost = "*"

// sitePolicy decides which Moodle sites a caller may point the server at. Without it, a
// caller-supplied URL would turn the Worker into an open HTTP proxy.
type sitePolicy struct {
	defaultURL   string
	allowedHosts map[string]bool
	allowAny     bool
	insecure     bool
}

func newSitePolicy(cfg Config) sitePolicy {
	p := sitePolicy{
		defaultURL:   strings.TrimRight(cfg.MoodleURL, "/"),
		allowedHosts: map[string]bool{},
		insecure:     cfg.AllowInsecureSites,
	}
	for _, h := range cfg.AllowedHosts {
		h = strings.ToLower(strings.TrimSpace(h))
		switch h {
		case "":
		case anyHost:
			p.allowAny = true
		default:
			p.allowedHosts[h] = true
		}
	}
	if u, err := url.Parse(p.defaultURL); err == nil && len(p.allowedHosts) == 0 {
		p.allowedHosts[strings.ToLower(u.Hostname())] = true // secure default: the configured site only
	}
	return p
}

var errSiteNotAllowed = errors.New("this Moodle site is not allowed on this server")

// validate normalises a caller-supplied site URL or explains why it is refused.
func (p sitePolicy) validate(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return "", errors.New("invalid Moodle URL")
	}
	switch {
	case u.Scheme != "https" && !(p.insecure && u.Scheme == "http"):
		return "", errors.New("Moodle URL must use https")
	case u.User != nil || u.RawQuery != "" || u.Fragment != "":
		return "", errors.New("Moodle URL must not contain credentials, query or fragment")
	case !p.insecure && !isPublicHostname(u.Hostname()):
		return "", errors.New("Moodle URL must be a public hostname")
	case !p.allowAny && !p.allowedHosts[strings.ToLower(u.Hostname())]:
		return "", errSiteNotAllowed
	}
	return strings.TrimRight(u.String(), "/"), nil
}

// resolve returns the site for a request: the SiteHeader if set, else the default.
func (p sitePolicy) resolve(r *http.Request) (string, error) {
	raw := strings.TrimSpace(r.Header.Get(SiteHeader))
	if raw == "" {
		return p.defaultURL, nil
	}
	site, err := p.validate(raw)
	if err != nil {
		return "", fmt.Errorf("%s: %w", SiteHeader, err)
	}
	return site, nil
}

func isPublicHostname(host string) bool {
	host = strings.ToLower(host)
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") ||
		strings.HasSuffix(host, ".internal") || !strings.Contains(host, ".") {
		return false
	}
	return net.ParseIP(host) == nil
}

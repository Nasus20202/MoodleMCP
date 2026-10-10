//go:build js

package main

import (
	"net/http"

	"github.com/syumai/workers-go/cloudflare"
	"github.com/syumai/workers-go/cloudflare/fetch"
)

func getenv(k string) string { return cloudflare.Getenv(k) }

// httpClient uses the Workers fetch API; Go's own js transport breaks on Workers.
func httpClient() *http.Client { return fetch.NewClient().HTTPClient(fetch.RedirectModeFollow) }

//go:build !js

package main

import (
	"net/http"
	"os"
)

func getenv(k string) string { return os.Getenv(k) }

func httpClient() *http.Client { return http.DefaultClient }

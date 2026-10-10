package server

import (
	"context"
	"net/http"
)

// credentials identify whose Moodle data a request may read: the token owner, on the chosen site.
type credentials struct {
	Token string
	Site  string
}

type credentialsKey struct{}

func credentialsFrom(ctx context.Context) (credentials, bool) {
	c, ok := ctx.Value(credentialsKey{}).(credentials)
	return c, ok
}

// withCredentials rejects requests without a token or with a disallowed site, and otherwise
// passes both to next through the request context.
func withCredentials(policy sitePolicy, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := Token(r)
		if token == "" {
			w.Header().Set("WWW-Authenticate", `Bearer realm="moodle-mcp"`)
			http.Error(w, "missing Moodle token: send Authorization: Bearer <token>", http.StatusUnauthorized)
			return
		}
		site, err := policy.resolve(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		ctx := context.WithValue(r.Context(), credentialsKey{}, credentials{Token: token, Site: site})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

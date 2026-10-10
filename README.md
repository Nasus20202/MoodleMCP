# moodle-mcp

Stateless, **read-only** [MCP](https://modelcontextprotocol.io) server for Moodle, written in Go and built for
Cloudflare Workers (`GOOS=js GOARCH=wasm` via [workers-go](https://github.com/syumai/workers-go)). It works with any
agent or IDE that supports remote MCP servers (Streamable HTTP). Nothing is stored: every request carries the user's
Moodle mobile token.

The landing page at `/` (Svelte 5 + Tailwind, in `web/`) walks users through getting a token (QR screenshot or browser
sign-in), shows the connection details, and lists the tools live from the server.

## Connecting an agent
Add a remote MCP server with URL `https://<host>/mcp` and these headers:

| Header | Required | Meaning |
| --- | --- | --- |
| `Authorization: Bearer <token>` (or `X-Moodle-Token`) | yes | the user's Moodle mobile web service token |
| `X-Moodle-URL: https://host/path` | no | Moodle site to use; defaults to `MOODLE_URL` |

Example for Claude Code:
```sh
claude mcp add --transport http moodle https://<host>/mcp --header "Authorization: Bearer <token>"
```

## Configuration
Set in `wrangler.jsonc` (or as environment variables for `go run .`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOODLE_URL` | `https://enauczanie.pg.edu.pl/2025` | default Moodle site |
| `ALLOWED_MOODLE_HOSTS` | host of `MOODLE_URL` | comma-separated hosts callers may select via `X-Moodle-URL`; `*` allows any public https host |
| `LOG_LEVEL` | `info` | `debug` also logs successful Moodle calls |

`X-Moodle-URL` must be https with a public hostname. The allow-list keeps the Worker from becoming an open proxy, so
widen it deliberately.

## Getting a token without the web page
```sh
go run ./cmd/moodle-token https://enauczanie.pg.edu.pl/2025   # prints a login URL (CAS/SSO)
go run ./cmd/moodle-token 'moodlemobile://token=...'          # decodes the redirect into a header
```
If a site enables "QR code with automatic login", pass the decoded QR text instead. enauczanie.pg.edu.pl has this disabled.

## Develop
```sh
npm install && npm start     # builds web + WASM, runs wrangler dev on :8787
PORT=8787 go run .           # backend only, native Go
cd web && npm run dev        # Vite with hot reload, proxies /api and /mcp to :8787
npm test                     # Go tests (-race) and web tests
npm run check                # go vet and svelte-check
```

## Deploy
`npm run deploy`. The WASM is ~4 MB gzipped, so it needs the Workers Paid plan (3 MB limit on Free).

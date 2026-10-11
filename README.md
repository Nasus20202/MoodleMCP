# moodle-mcp

Read-only MCP server for Moodle, running on Cloudflare Workers (TypeScript, Hono, the official MCP SDK). It is
stateless: each request carries the user's own Moodle mobile token, and nothing is stored.

It defaults to [eNauczanie PG](https://enauczanie.pg.edu.pl/2025) but works with any Moodle site that has the mobile web
service enabled. The page served at `/` explains how to get a token and how to connect an agent.

## What it serves

| Path                                         | Purpose                                                              |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `/`                                          | setup page (Svelte), served as static assets                         |
| `/mcp`                                       | the MCP endpoint (Streamable HTTP, stateless)                        |
| `/api/config`, `/api/tools`, `/api/exchange` | JSON API behind the setup page (default site, tool list, QR → token) |
| `/oauth/*`, `/.well-known/oauth-*`           | OAuth provider; only when `OAUTH_SECRET` is set                      |

## Connect an agent

There are two ways to authenticate. Both end up using the same Moodle token.

### With a header

Add a remote MCP server at `https://<your-host>/mcp` with these headers:

| Header                          | Required | Meaning                                                      |
| ------------------------------- | -------- | ------------------------------------------------------------ |
| `Authorization: Bearer <token>` | yes      | the user's Moodle mobile token (`X-Moodle-Token` also works) |
| `X-Moodle-URL`                  | no       | Moodle site to use; defaults to `MOODLE_URL`                 |

```sh
claude mcp add --transport http moodle https://<your-host>/mcp --header "Authorization: Bearer <token>"
```

### With OAuth

For clients that cannot send a custom header (ChatGPT, claude.ai connectors), add just `https://<your-host>/mcp`. The
client discovers the OAuth endpoints, opens a page on this server, and you paste your Moodle token and site there. The
token is checked against Moodle, and the client receives an encrypted access token that carries it. This needs the
`OAUTH_SECRET` secret; without it the OAuth routes are off. Use automatic (dynamic) client registration, or leave the client
ID and secret empty: the server registers clients itself and needs no secret from them.

Config examples: for Claude Code, `claude mcp add --transport http moodle https://<your-host>/mcp`, then run `/mcp` and
choose "Authenticate". Generic JSON, with no credentials in it:

```json
{ "mcpServers": { "moodle": { "type": "http", "url": "https://<your-host>/mcp" } } }
```

OpenCode (`opencode.json`: `{"mcp":{"moodle":{"type":"remote","url":"https://<your-host>/mcp"}}}`, then
`opencode mcp auth moodle`) and Codex (`codex mcp add moodle --url https://<your-host>/mcp`) work the same way. The
setup page shows file and command examples for each.

### Getting a Moodle token

Follow step 1 on the setup page: sign in with your university account, or drop a screenshot of Moodle's mobile-app QR
code if your site has QR login enabled.

## Tools

All read-only: `get_site_info`, `list_courses`, `search_courses`, `get_course_contents`, `list_assignments`,
`get_submission_status`, `get_upcoming_events`, `get_grades`, `list_forums`, `list_forum_discussions`, `list_pages`,
`get_notifications`. `GET /api/tools` lists them with their arguments.

## OAuth tokens

Nothing is stored. Client ids, authorization codes, access tokens and refresh tokens are all `mm1.` followed by
base64url of a random 12-byte IV and an AES-256-GCM ciphertext. The key is derived from `OAUTH_SECRET`, and the token
kind is authenticated, so one kind cannot be used as another. The decrypted payload holds the Moodle `token` and `site`
(plus the client id, redirect URI and PKCE challenge for codes) and an expiry.

| Token         | Lifetime   | Notes                                                                |
| ------------- | ---------- | -------------------------------------------------------------------- |
| client id     | no expiry  | holds the registered redirect URIs, which are matched exactly        |
| code          | 60 seconds | PKCE (S256) required                                                 |
| access token  | 12 hours   | sent as `Authorization: Bearer` to `/mcp`                            |
| refresh token | 90 days    | each refresh returns a new pair, so active connectors stay signed in |

Limits of this design: a single token cannot be revoked (rotating `OAUTH_SECRET` signs everyone out), and anyone holding
an access token can read that user's Moodle until it expires. The Moodle token inside has its own expiry, set by Moodle.

## Configuration

Set `vars` in `wrangler.jsonc`, or in `.dev.vars` locally. `OAUTH_SECRET` is a secret, not a var.

| Variable               | Default                             | Meaning                                                                                                                                   |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `MOODLE_URL`           | `https://enauczanie.pg.edu.pl/2025` | default Moodle site                                                                                                                       |
| `ALLOWED_MOODLE_HOSTS` | `*`                                 | hosts callers may pick with `X-Moodle-URL`, comma-separated; `*` allows any public https host; empty allows only the host of `MOODLE_URL` |
| `LOG_LEVEL`            | `info`                              | `debug` also logs successful Moodle calls                                                                                                 |
| `OAUTH_SECRET`         | unset                               | 32+ random characters (`openssl rand -hex 32`); enables OAuth. Keep it stable                                                             |

The site is chosen by the caller, so it must be https, a public hostname, and on an allowed host. With `*`, anyone can use
your deployment to reach any public Moodle site; restrict the list if you don't want that.

## Logging

Logs are JSON lines (`wrangler tail`, or the dashboard). Every line for a request carries `ip` (from Cloudflare's
`CF-Connecting-IP`) and `tokenId`, the first 12 hex characters of the SHA-256 of the credential the client sent, so you can
follow one user's activity without seeing their token. Tokens, OAuth codes, QR login keys and request parameters are never
logged. The IP address is personal data under GDPR, so mind your retention settings.

## Development

Needs Node 24.21 or newer (see `.node-version`) and [pnpm](https://pnpm.io) (`corepack enable` picks the right version).

```sh
pnpm install
pnpm dev         # wrangler dev on :8787 (page, /api, /mcp)
pnpm check       # ESLint, Prettier, typecheck, tests
pnpm format      # fix what can be fixed
```

Code is in `packages/`: `shared` (types and link parsing), `server` (the Worker), `web` (the setup page).
See [AGENTS.md](AGENTS.md) for conventions and how to add a tool.

## Deploy

```sh
pnpm exec wrangler login
pnpm exec wrangler secret put OAUTH_SECRET
pnpm run deploy
```

The Worker is routed to the custom domain in `wrangler.jsonc`; change or remove `routes` for your own.

Or let GitHub do it: `deploy.yml` tests and deploys every push to `main`. It needs the repository secrets
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `OAUTH_SECRET`.

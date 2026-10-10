# moodle-mcp

Read-only MCP server for Moodle, running on Cloudflare Workers. Written in TypeScript with Hono and the official MCP SDK.
It is stateless: each request carries the user's own Moodle mobile token, and nothing is stored.

It defaults to [eNauczanie PG](https://enauczanie.pg.edu.pl/2025) but works with any Moodle site that has the mobile web
service enabled. The page served at `/` explains how to get a token and how to connect an agent.

## Connect an agent

Add a remote MCP server (Streamable HTTP) at `https://<your-host>/mcp` with these headers:

| Header                          | Required | Meaning                                                      |
| ------------------------------- | -------- | ------------------------------------------------------------ |
| `Authorization: Bearer <token>` | yes      | the user's Moodle mobile token (`X-Moodle-Token` also works) |
| `X-Moodle-URL`                  | no       | Moodle site to use; defaults to `MOODLE_URL`                 |

For example, with Claude Code:

```sh
claude mcp add --transport http moodle https://<your-host>/mcp --header "Authorization: Bearer <token>"
```

To get a token, follow step 1 on the page served at `/`: sign in with your university account, or drop a screenshot of
Moodle's mobile-app QR code if your site has that enabled.

## Tools

All read-only: `get_site_info`, `list_courses`, `search_courses`, `get_course_contents`, `list_assignments`,
`get_submission_status`, `get_upcoming_events`, `get_grades`, `list_forums`, `list_forum_discussions`, `list_pages`,
`get_notifications`. `GET /api/tools` lists them with their arguments.

## Configuration

Set under `vars` in `wrangler.jsonc`, or in `.dev.vars` locally.

| Variable               | Default                             | Meaning                                                                                                                                   |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `MOODLE_URL`           | `https://enauczanie.pg.edu.pl/2025` | default Moodle site                                                                                                                       |
| `ALLOWED_MOODLE_HOSTS` | `*`                                 | hosts callers may pick with `X-Moodle-URL`, comma-separated; `*` allows any public https host; empty allows only the host of `MOODLE_URL` |
| `LOG_LEVEL`            | `info`                              | `debug` also logs successful Moodle calls                                                                                                 |

`X-Moodle-URL` is chosen by the caller, so it must be https with a public hostname and on an allowed host. With `*`,
anyone can use your deployment to reach any public Moodle site; restrict the list if you don't want that.

## Logging

Logs are JSON lines (`wrangler tail`, or the dashboard). Every line for a request carries `ip` (from Cloudflare's
`CF-Connecting-IP`) and `tokenId`, the first 12 hex characters of the token's SHA-256, so you can follow one user's
activity without seeing their token. Tokens, QR login keys and request parameters are never logged. The IP address is
personal data under GDPR, so mind your retention settings.

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
pnpm run deploy
```

Or let GitHub do it: `deploy.yml` tests and deploys every push to `main`. It needs the repository secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

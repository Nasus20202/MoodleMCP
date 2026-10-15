# moodle-mcp

A read-only [MCP](https://modelcontextprotocol.io) server for Moodle, running on Cloudflare Workers. It is stateless:
every request carries the user's own Moodle mobile token, and nothing is stored.

It defaults to [eNauczanie PG](https://enauczanie.pg.edu.pl/2025) but works with any Moodle site that has the mobile
web service enabled. The setup page served at `/` explains how to get a token and connect an agent.

## Connect an agent

Add a remote MCP server (Streamable HTTP) at `https://<your-host>/mcp`, and authenticate in one of two ways. Both end up
using the same Moodle token.

**Header.** Send `Authorization: Bearer <token>` (or `X-Moodle-Token: <token>`). To use a site other than the default,
also send `X-Moodle-URL: https://<moodle-site>`.

```sh
claude mcp add --transport http moodle https://<your-host>/mcp --header "Authorization: Bearer <token>"
```

**OAuth**, for clients that cannot send headers (ChatGPT, claude.ai connectors). Add just the URL. The client opens a
page on this server where you paste your Moodle token and site; the client then receives an encrypted access token that
carries it. Needs `OAUTH_SECRET` (see [Configuration](#configuration)); without it the OAuth routes are off. Use dynamic
client registration, or leave the client ID and secret empty.

**Getting a token:** follow step 1 on the setup page. Sign in with your university account, or drop a screenshot of
Moodle's mobile-app QR code if your site has QR login enabled. The setup page also has config snippets for common
clients.

## Tools

All tools are read-only. `GET /api/tools` lists them with their arguments, and each description tells the agent which
tool to call next and where its ids come from.

| Area      | Tools                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| Site      | `get_site_info`                                                                                             |
| Courses   | `list_courses`, `search_courses`, `get_course_contents`, `get_course_module`                                |
| Materials | `read_file`, `list_resources`, `list_pages`, `list_labels`, `list_urls`, `list_wikis`, `get_wiki_pages`     |
| Work      | `list_assignments`, `get_submission_status`, `list_quizzes`, `get_quiz_attempts`, `get_quiz_attempt_review` |
| Calendar  | `get_upcoming_events`, `get_course_events`, `get_course_completion`                                         |
| Grades    | `get_grades`, `get_grades_overview`                                                                         |
| Forums    | `list_forums`, `list_forum_discussions`, `get_forum_posts`                                                  |
| Activity  | `get_notifications`                                                                                         |

`read_file` takes a `fileurl` from another tool and returns text for PDF (text layer only), DOCX, PPTX, XLSX, HTML and
plain text; images come back as images. Files up to 20 MB, paged with `offset` and `next_offset`. The URL must be on
the Moodle site; redirects are not followed. Its `mode` picks how a file is read:

| Mode       | What it does                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| `auto`     | default: `markdown` for PDF, DOCX, XLSX and HTML when the AI binding is there, `extract` for everything else |
| `markdown` | Workers AI [`toMarkdown`][tomarkdown]: no Worker CPU, keeps headings and tables; an image gets a description |
| `extract`  | the Worker's own parsers; PDFs are read only as far as each call goes (at most 20 pages) and take a `page`   |
| `resource` | the unmodified file: an image, audio or embedded resource block by type                                      |

If a conversion fails (or the daily Workers AI allowance runs out), `read_file` falls back to `extract` and says so.
Images are only described when `markdown` is asked for, because a description is a summary and uses the allowance;
images inside documents are never converted. With `markdown`, files are sent to Workers AI for conversion.

[tomarkdown]: https://developers.cloudflare.com/workers-ai/features/markdown-conversion/

## Configuration

Set `vars` in `wrangler.jsonc`, or in `.dev.vars` locally. `OAUTH_SECRET` is a secret, not a var.

| Variable               | Default                             | Meaning                                                                                                                      |
| ---------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `MOODLE_URL`           | `https://enauczanie.pg.edu.pl/2025` | default Moodle site                                                                                                          |
| `ALLOWED_MOODLE_HOSTS` | `*`                                 | hosts callers may pick with `X-Moodle-URL`, comma-separated; `*` is any public https host; empty is only `MOODLE_URL`'s host |
| `LOG_LEVEL`            | `info`                              | `debug` also logs successful Moodle calls                                                                                    |
| `OAUTH_SECRET`         | unset                               | 32+ random characters (`openssl rand -hex 32`); enables OAuth. Keep it stable                                                |

With `*`, anyone can use your deployment to reach any public Moodle site; restrict the list if you don't want that.

### OAuth tokens

Client ids, codes, access tokens and refresh tokens are all sealed (AES-256-GCM, key derived from `OAUTH_SECRET`), so
nothing is stored. The sealed payload holds the Moodle token and site. Codes require PKCE (S256).

| Token         | Lifetime   |
| ------------- | ---------- |
| client id     | no expiry  |
| code          | 60 seconds |
| access token  | 12 hours   |
| refresh token | 90 days    |

A single token cannot be revoked (rotating `OAUTH_SECRET` signs everyone out), and anyone holding an access token can
read that user's Moodle until it expires.

### Logging

Logs are JSON lines (`wrangler tail`, or the dashboard), one per request, including 404s. Each carries `ip` (Cloudflare's
`CF-Connecting-IP`) and `tokenId`, the first 12 hex characters of the SHA-256 of the credential, so you can follow one
user without seeing their token. Tokens, OAuth codes, QR keys and request parameters are never logged. The IP address is
personal data under GDPR, so mind your retention settings.

## Development

Needs Node 26.11 or newer (see `.node-version`) and [pnpm](https://pnpm.io) (`corepack enable` picks the right version).

```sh
pnpm install
pnpm dev            # Worker on :8787 + Vite on :5173; open :5173 (no Workers AI: read_file extracts)
pnpm check          # ESLint, Prettier, typecheck, tests (including the end-to-end tests)
pnpm test:browser   # Playwright tests of the setup and OAuth pages
pnpm format         # fix what can be fixed
```

Code lives in `packages/`: `shared`, `server` (the Worker), `web` (the setup page) and `e2e`. The end-to-end tests run
the bundled Worker in workerd against a mock Moodle, so they need no network. The browser tests need Chromium: run
`pnpm --filter @moodle-mcp/e2e exec playwright install chromium` once. See [AGENTS.md](AGENTS.md) for conventions and
how to add a tool.

## Deploy

```sh
pnpm exec wrangler login
pnpm exec wrangler secret put OAUTH_SECRET
pnpm run deploy
```

`wrangler.jsonc` routes the Worker to a custom domain; change or remove `routes` for your own. Alternatively,
`deploy.yml` tests and deploys every push to `main`; it needs the repository secrets `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` and `OAUTH_SECRET`.

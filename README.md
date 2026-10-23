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

| Area      | Tools                                                                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site      | `get_site_info`                                                                                                                                                       |
| Courses   | `list_courses`, `search_courses`, `get_course_contents`, `get_course_module`                                                                                          |
| Materials | `read_file`, `list_activities`, `get_page`, `list_wikis`, `get_wiki_pages`, `get_glossary_entries`, `get_lesson_pages`, `get_choice_results`, `get_feedback_analysis` |
| Work      | `list_assignments`, `get_submission_status`, `list_quizzes`, `get_quiz_attempts`, `get_quiz_attempt_review`                                                           |
| Calendar  | `get_upcoming_events`, `get_course_events`, `get_course_completion`                                                                                                   |
| Grades    | `get_grades`, `get_grades_overview`                                                                                                                                   |
| Forums    | `list_forums`, `list_forum_discussions`, `get_forum_posts`                                                                                                            |
| People    | `get_course_participants`, `get_user_profile`                                                                                                                         |
| Messages  | `list_conversations`, `get_conversation_messages`                                                                                                                     |
| Activity  | `get_notifications`                                                                                                                                                   |

`read_file` takes a `fileurl` from another tool and returns text for PDF (text layer only), DOCX, PPTX, XLSX, LibreOffice (ODT, ODS, ODP), HTML and
plain text; images come back as images. A ZIP archive comes back as a list of its files, and passing one of their paths
as `entry` reads that file like any other (archives inside archives are not opened). A file whose type the server
and its name do not give is identified from its content (a few magic numbers, or valid UTF-8 text). Files up to 20 MB, paged with
`offset` and `next_offset`. The URL must be on the Moodle site; redirects are not followed. Its `mode` picks how a file is read:

| Mode       | What it does                                                                                                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto`     | default: `markdown` for PDF, DOCX and XLSX when the AI binding is there; `extract` for everything else, HTML included (the Worker's own HTML-to-Markdown converter)                                                                            |
| `markdown` | Workers AI [`toMarkdown`][tomarkdown]: no Worker CPU, keeps headings and tables; an image gets a description                                                                                                                                   |
| `extract`  | the Worker's own parsers; PDFs are read only as far as each call goes (at most 20 pages) and take a `page`. Word keeps headings, lists, bold and tables, Excel becomes one Markdown table per sheet with dates as dates, HTML becomes Markdown |
| `resource` | the unmodified file: an image, audio or embedded resource block by type                                                                                                                                                                        |

If a conversion fails (or the daily Workers AI allowance runs out), `read_file` falls back to `extract` and says so.
Images are only described when `markdown` is asked for, because a description is a summary and uses the allowance;
images inside documents are never converted. With `markdown`, files are sent to Workers AI for conversion.

`list_activities` lists one kind of activity of a course: `resource`, `page`, `url`, `label`, `glossary`, `lesson`,
`choice` or `feedback`. Pages are listed without their bodies (name, ids and size), because a course can hold hundreds
of kilobytes of them; `get_page` reads one by the course-module id (the `id` in a Moodle link). Its `format` works like
`read_file`'s `mode`: `auto` (default) and `extract` are Markdown from the Worker's own HTML-to-Markdown converter
(headings, lists, links and tables; no styles or scripts), `markdown` asks Workers AI instead (falling back to the
converter when it is missing or fails), and `raw` is the HTML. The converter is the default for HTML because it is
deterministic, free, and cleaner than Workers AI on Moodle's editor markup, and it marks where each pasted picture
sat. Long pages are paged with `offset` and
`next_offset`; pictures come back as image blocks. `get_glossary_entries`, `get_lesson_pages`, `get_choice_results`
and `get_feedback_analysis` read the matching activity types; none of them starts an attempt or records a view.

`get_course_participants` lists who is enrolled (`role`: all, teachers or students), `get_user_profile` shows one
person's contact details, and `list_conversations` and `get_conversation_messages` read the signed-in user's own
private and group messages. These use only Moodle functions that read: reading does not mark messages as read, tell
the sender, or record a profile view, and the server never logs names, addresses or message text (only sizes). They
are exactly as visible as in the Moodle app for that user: Moodle decides what the token may see, and it still records
the web service request itself, like any other call, in its own logs.

**What a tool returns.** Most tools relay Moodle's JSON after a shared cleanup: fields that say nothing are dropped
(`null`, empty strings and objects, empty `warnings`, text-format flags, people's picture links, AI-tool flags,
icons; an empty list, zero and false stay), scripts and styles are removed from HTML, multi-language text is resolved to the user's language, and pictures
pasted into HTML come back as image blocks. A few tools shape their answer for a reader instead:
`get_course_contents` is a Markdown outline (section headings, one line per activity with its `cmid` and `instance`,
files and links under it, labels with their text), `get_page` and `read_file` return Markdown, and these keep
the fields that answer the question and write HTML texts (intros, descriptions, feedback) as short Markdown:
`list_activities`, `list_quizzes`, `get_course_events`, `get_upcoming_events`, `get_grades` and
`get_course_completion`. Any result over 80,000 characters is cut with a `truncated` marker that
says how much there was, so a client never has to cut it silently.

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
pnpm test:clients   # Claude Code, Codex and opencode against the Worker (needs those CLIs installed)
pnpm format         # fix what can be fixed
```

Code lives in `packages/`: `shared`, `server` (the Worker), `web` (the setup page) and `e2e`. The end-to-end tests run
the bundled Worker in workerd against a mock Moodle, so they need no network. The browser tests need Chromium: run
`pnpm --filter @moodle-mcp/e2e exec playwright install chromium` once. The client tests run the real CLIs, which
need no login: a scripted model stands in for the provider (`packages/e2e/src/clients`). See [AGENTS.md](AGENTS.md) for conventions and
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

# AGENTS.md

Stateless, read-only MCP server for Moodle on Cloudflare Workers, plus a Svelte setup page. See [README.md](README.md) for
what it does and how to run and deploy it. This file is what you need to change it safely.

## Layout

pnpm workspaces, TypeScript throughout (Node and pnpm versions are pinned in `.node-version` and `packageManager`).

- `packages/shared`: types and pure logic used by both sides (API bodies, header names, Moodle link parsing). Consumed as
  source, no build step.
- `packages/server`: the Worker. Entry `src/worker.ts`; Hono app in `app.ts`; MCP endpoint `mcp.ts`; `moodle/` client and
  function allow-list; `tools/`; `oauth/` and `routes/oauth.ts`.
- `packages/web`: Svelte 5 + Tailwind 4, built by Vite into `packages/web/dist` and served as static assets.
- `packages/e2e`: end-to-end tests. They run the bundled Worker in workerd (Miniflare) with the outbound network replaced
  by a mock Moodle (`src/mock/`); `src/worker.ts` boots it, `src/world.ts` is the per-suite setup. Browser tests
  (Playwright, `src/browser/*.spec.ts`, run with `pnpm test:browser`) drive the built setup page and the OAuth
  consent page against the same stack.
- `wrangler.jsonc`: `/mcp`, `/api/*`, `/oauth/*` and `/.well-known/*` run the Worker first; everything else is an asset.

## Commands

```sh
pnpm check     # ESLint + Prettier + typecheck + tests: run before finishing any change
pnpm format    # eslint --fix and prettier --write
pnpm types     # regenerate packages/server/worker-configuration.d.ts after editing wrangler.jsonc
               # (move .dev.vars away first: wrangler adds its secrets to the types, which CI does not have)
pnpm run deploy  # not `pnpm deploy`, which is a different built-in command
```

## Rules that matter

- **Read-only, always.** Every Moodle call goes through `MoodleClient.call`, which only accepts functions listed in
  `MoodleFunction` (`moodle/functions.ts`). Anything added there must be a read operation (no `view_*`, which writes
  logs, and nothing that creates, updates, submits or deletes). The one other path is `MoodleClient.download`, a GET of a
  file URL that `resolveFileUrl` has confined to the site's `pluginfile.php`.
- **Never log or return secrets.** Tokens, OAuth codes and sealed values, QR login keys and Moodle parameter values must
  not appear in logs, errors or responses. Tests assert this. Users are identified in logs only by `ip` and `tokenId`
  (`http/client-info.ts`). Log outcomes and sizes (`function`, `mime`, `format`, `bytes`, `ms`, `ok`, an error code),
  never full URLs, file names, file contents or parameter values. The one exception is `site`, the validated
  Moodle site address (https, no credentials or query), which names the institution and not the user.
- **Site policy is a security boundary.** `X-Moodle-URL` is caller-controlled; `SitePolicy` keeps the Worker from becoming
  an open proxy. Apply it to any new code path that contacts a caller-supplied URL (as `/api/exchange` and the OAuth
  consent page do).
- **Stateless.** No user-dependent module state, no storage bindings. A fresh MCP server is built per request. OAuth
  follows the same rule: `oauth/sealer.ts` seals client ids, codes, access and refresh tokens (AES-GCM, key from
  `OAUTH_SECRET`), and the access token carries the Moodle token. Redirect URIs live inside the sealed client id and are
  matched exactly; never redirect to an unvalidated URI.
- **The AI binding is optional.** `env.AI` (Workers AI `toMarkdown`, for `read_file`'s markdown mode) is absent under
  `pnpm dev` (`wrangler dev --local`) and in the e2e tests, and a conversion can fail when the daily allowance is spent:
  always fall back to extraction. Never let it convert images unless the caller asked for markdown.
- **Call `fetch` as a plain function.** On Workers, `this.fetchImpl(...)` throws "Illegal invocation" (regression test in
  `moodle/client.test.ts`).
- **Types live in their own files** (`packages/shared/src/api.ts`, `packages/web/src/lib/types/`). API shapes are defined
  once in `shared` and used by server and web.

## Adding a tool

1. Add a name to `ToolName` (`tools/names.ts`).
2. Add the Moodle function to `MoodleFunction` if it is not there yet.
3. Add a `defineTool({...})` entry in `tools/definitions.ts` (zod input schema, function, params mapping).
4. Add a row to the `it.each` table in `app.test.ts`. The web page and `/api/tools` pick the tool up automatically.
5. Teach the mock Moodle the function (`packages/e2e/src/mock/moodle.ts`, with fixtures in `data.ts`) and add a row to
   `CASES` in `packages/e2e/src/tools.e2e.test.ts`; that suite fails if a tool has no row.

Write the description for the model: say what the tool returns, when to prefer a sibling tool, and which tool an id
argument comes from (`describe()` on the argument repeats it). A tool that is not a plain relay of one Moodle function
(like `read_file`) uses `defineCustomTool` and returns content blocks.

## Conventions

- Strict TypeScript with `erasableSyntaxOnly`: no enums, namespaces or constructor parameter properties; use `as const`
  objects with a matching type. Import local files with the `.ts` extension. Zod is imported as `zod/v4`.
- Interfaces, not type aliases, for object shapes (an ESLint rule). An interface is not assignable to
  `Record<string, unknown>`; spread it where a record is needed.
- Style is enforced by ESLint (type-aware) and Prettier; run `pnpm format` instead of fixing it by hand. `no-console` is an
  error; the logger is the one place that may use the console.
- Keep Svelte components thin: logic goes in `packages/web/src/lib` (or `shared`) where it is unit tested.
- Tests sit next to the code (`*.test.ts`). Use `fakeMoodle` from `server/src/test-utils.ts` instead of the network.
  Behaviour that crosses the HTTP boundary (auth headers, OAuth, the real Worker runtime) is tested in `packages/e2e`
  against the mock Moodle; keep the mock faithful to Moodle (real error codes, enrolment checks, HTTP 200 with an
  exception body) rather than making it echo whatever the Worker sends.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`, imperative,
  lowercase. Types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`; mark breaking changes with
  `!` and a `BREAKING CHANGE:` footer. One logical change per commit.

## Dependencies

- Pin exact versions; Renovate does the updates. Do not loosen ranges or hand-bump versions.
- Keep the `typescript` and `@typescript/native` aliases in the root `package.json` as they are: tools need the first,
  `tsc` comes from the second.
- A package that needs a build script must be approved in `allowBuilds` in `pnpm-workspace.yaml`.
- Do not bypass `minimumReleaseAge`; add a deliberate exception to `minimumReleaseAgeExclude` instead.

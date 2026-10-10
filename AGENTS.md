# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## What this is

A **stateless, read-only MCP server for Moodle**, deployed on Cloudflare Workers, plus a small setup web page.
Any MCP client (Claude, Cursor, IDEs, ...) connects with the user's Moodle mobile token in a request header.
Nothing is stored server side. The default site is https://enauczanie.pg.edu.pl/2025.

## Layout

pnpm workspaces monorepo, TypeScript throughout. Node is pinned in `.node-version`, pnpm in `packageManager`.

| Path              | Role                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared` | Types and pure logic used by both sides: API bodies, header names, Moodle link parsing (`token-link.ts`). Source is consumed directly (no build step). |
| `packages/server` | The Worker: Hono app, MCP endpoint (`@modelcontextprotocol/server` v2), Moodle client, tools. Entry: `src/worker.ts`.                                  |
| `packages/web`    | Svelte 5 + Tailwind 4 setup page, built by Vite into `packages/web/dist`, served as Workers static assets.                                             |
| `wrangler.jsonc`  | Worker config; `/mcp` and `/api/*` run the Worker first, everything else is a static asset.                                                            |

## Commands

```sh
pnpm install
pnpm dev                 # wrangler dev on :8787 (builds the web app first)
pnpm check               # ESLint + Prettier + typecheck + tests: run before finishing any change
pnpm format              # eslint --fix and prettier --write
pnpm test                # vitest across all packages (pnpm exec vitest run --project server)
pnpm types               # regenerate packages/server/worker-configuration.d.ts after editing wrangler.jsonc
pnpm run deploy          # note: plain `pnpm deploy` is a different, built-in pnpm command
```

## Rules that matter

- **Read-only, always.** Every Moodle call goes through `MoodleClient.call`, which only accepts functions listed in
  `MoodleFunction` (`moodle/functions.ts`). Adding a function there means it must be a read operation.
- **Never log or return secrets.** Tokens, QR login keys and Moodle parameter values must not appear in logs, errors or
  responses. Tests assert this; keep them passing. Log only function names, tool names, status and timings. Users are
  identified in logs only by `ip` and `tokenId` (a truncated SHA-256 of the token), attached per request by
  `http/client-info.ts` and carried by `logger.child(...)`.
- **Site policy is a security boundary.** `X-Moodle-URL` is caller-controlled; `SitePolicy` (`site-policy.ts`) keeps the
  Worker from becoming an open proxy (https only, public hostnames, allow-listed hosts). Do not bypass it, and apply it
  to any new code path that contacts a caller-supplied URL (as `/api/exchange` does).
- **Stateless.** No module-level mutable state that depends on a user, no storage bindings. A fresh MCP server is built
  per request in `mcp.ts`.
- **Call `fetch` as a plain function.** On Workers, `this.fetchImpl(...)` throws "Illegal invocation". See the
  regression test in `moodle/client.test.ts`.
- **Types live in their own files** (`packages/shared/src/api.ts`, `packages/web/src/lib/types/`). API shapes are defined
  once in `shared` and used by server and web.

## Adding a tool

1. Add a name to `ToolName` (`packages/server/src/tools/names.ts`).
2. Add the Moodle function to `MoodleFunction` if it is not there yet.
3. Add a `defineTool({...})` entry in `tools/definitions.ts` (zod input schema, function, params mapping).
4. Add a row to the `it.each` table in `app.test.ts` (parameter mapping). The web page and `/api/tools` pick the tool up
   automatically.

## Conventions

- Strict TypeScript with `erasableSyntaxOnly`: no enums, namespaces or constructor parameter properties. Use `as const`
  objects with a matching type instead. Import local files with the `.ts` extension.
- ESLint (flat config, `eslint.config.js`) with type-aware rules, and Prettier (`.prettierrc.json`, including Svelte and
  Tailwind class sorting). Run `pnpm format` instead of fixing style by hand. `no-console` is an error; the logger is the
  one place that may use the console.
- Interfaces, not type aliases, for object shapes (an ESLint rule). An interface is not assignable to
  `Record<string, unknown>`; spread it (`{ ...value }`) where a record is needed.
- Keep components thin: logic goes in `packages/web/src/lib` (or `shared`) where it is unit tested. Repeated Tailwind
  class lists become component classes in `app.css`.
- Tests sit next to the code (`*.test.ts`). Use `fakeMoodle` from `server/src/test-utils.ts` instead of the network.
- Zod is imported as `zod/v4` to match the MCP SDK.

## Dependencies

Versions are pinned exactly and updated by Renovate (`renovate.json`). TypeScript is installed twice on purpose:
`@typescript/native` is TypeScript 7 and provides `tsc` (fast typechecking of `shared` and `server`), while `typescript` is
an alias for `@typescript/typescript6`, the TypeScript 6 JavaScript API that typescript-eslint and `svelte-check` still
require (TypeScript 7 no longer ships that API). pnpm blocks dependency build scripts: a new package that needs one must be approved in
`allowBuilds` in `pnpm-workspace.yaml` (`pnpm approve-builds`). pnpm also holds back very new releases
(`minimumReleaseAge`); `minimumReleaseAgeExclude` lists deliberate exceptions.

## CI/CD

`.github/workflows/ci.yml` runs lint, typecheck, the generated-types check, tests and a `wrangler deploy --dry-run` on pull
requests. `deploy.yml` runs the same checks on pushes to `main`, then deploys with `wrangler-action`. It needs the
repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

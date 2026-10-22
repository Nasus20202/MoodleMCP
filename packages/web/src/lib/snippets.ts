import { SITE_HEADER } from '@moodle-mcp/shared';

import { mcpEndpoint } from './constants';

export interface ConnectionDetails {
  token: string;
  /** Set only when the site differs from the server default. */
  site?: string;
}

/** Headers an agent must send with every request. */
export function connectionHeaders({ token, site }: ConnectionDetails): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...(site ? { [SITE_HEADER]: site } : {}) };
}

/** Generic remote-MCP config accepted by most agents and IDEs (shape varies slightly by client). */
export function jsonConfig(details: ConnectionDetails): string {
  return JSON.stringify(
    { mcpServers: { moodle: { type: 'http', url: mcpEndpoint(), headers: connectionHeaders(details) } } },
    null,
    2,
  );
}

/** Remote-MCP config for OAuth sign-in: no credentials in it, the client runs the OAuth flow itself. */
export function oauthJsonConfig(): string {
  return JSON.stringify({ mcpServers: { moodle: { type: 'http', url: mcpEndpoint() } } }, null, 2);
}

/** Claude Code with OAuth: add the server, then sign in from its /mcp menu. */
export const oauthClaudeCodeCommand = (): string => `claude mcp add --transport http moodle ${mcpEndpoint()}`;

/** Example for one specific agent, Claude Code. */
export function claudeCodeCommand(details: ConnectionDetails): string {
  const headers = Object.entries(connectionHeaders(details)).map(([k, v]) => `  --header "${k}: ${v}"`);
  return [`claude mcp add --transport http moodle ${mcpEndpoint()}`, ...headers].join(' \\\n');
}

/** A copyable config for one agent. */
export interface ConfigExample {
  title: string;
  code: string;
  /** Extra step after saving the config, e.g. how to sign in. */
  note?: string | undefined;
}

const tomlString = (value: string) => JSON.stringify(value);

const OPENCODE_SCHEMA = 'https://opencode.ai/config.json';

/** Name of the environment variable the Codex command reads the token from. */
const TOKEN_ENV_VAR = 'MOODLE_MCP_TOKEN';

/** Codex's config.toml; static headers go in an inline table. */
export function codexConfig(details: ConnectionDetails): string {
  const headers = Object.entries(connectionHeaders(details))
    .map(([k, v]) => `${tomlString(k)} = ${tomlString(v)}`)
    .join(', ');
  return `[mcp_servers.moodle]\nurl = ${tomlString(mcpEndpoint())}\nhttp_headers = { ${headers} }`;
}

/** Codex command that reads the token from an environment variable (it cannot set other headers). */
export const codexCommand = ({ token }: ConnectionDetails): string =>
  `export ${TOKEN_ENV_VAR}=${token}\ncodex mcp add moodle --url ${mcpEndpoint()} --bearer-token-env-var ${TOKEN_ENV_VAR}`;

/** OpenCode's opencode.json: a remote server with static headers. */
export function opencodeConfig(details: ConnectionDetails): string {
  return JSON.stringify(
    {
      $schema: OPENCODE_SCHEMA,
      mcp: {
        moodle: { type: 'remote', url: mcpEndpoint(), enabled: true, headers: connectionHeaders(details) },
      },
    },
    null,
    2,
  );
}

const CUSTOM_SITE_NOTE = 'This command cannot set the Moodle site header; use the file for a custom site.';

/** Examples for sending the token as a header: generic, then a file and a command per agent. */
export function headerExamples(details: ConnectionDetails): ConfigExample[] {
  const commandNote = details.site ? CUSTOM_SITE_NOTE : undefined;
  return [
    { title: 'Generic MCP config (JSON)', code: jsonConfig(details) },
    { title: 'Claude Code: file (.mcp.json)', code: jsonConfig(details) },
    { title: 'Claude Code: command', code: claudeCodeCommand(details) },
    { title: 'OpenCode: file (opencode.json)', code: opencodeConfig(details) },
    {
      title: 'OpenCode: command',
      code: 'opencode mcp add',
      note: 'Interactive, and it cannot set headers: choose “Remote”, enter the URL, then add the headers in the file above.',
    },
    { title: 'Codex: file (~/.codex/config.toml)', code: codexConfig(details) },
    {
      title: 'Codex: command',
      code: codexCommand(details),
      note: commandNote,
    },
  ];
}

/** Examples for OAuth sign-in: no credentials, the client runs the flow itself. */
export function oauthExamples(): ConfigExample[] {
  const url = mcpEndpoint();
  return [
    { title: 'Generic MCP config (JSON)', code: oauthJsonConfig() },
    { title: 'Claude Code: file (.mcp.json)', code: oauthJsonConfig() },
    {
      title: 'Claude Code: command',
      code: oauthClaudeCodeCommand(),
      note: 'Then run /mcp in Claude Code and choose “Authenticate”.',
    },
    {
      title: 'OpenCode: file (opencode.json)',
      code: JSON.stringify({ $schema: OPENCODE_SCHEMA, mcp: { moodle: { type: 'remote', url } } }, null, 2),
    },
    { title: 'OpenCode: command', code: 'opencode mcp auth moodle', note: 'Run it after saving the file.' },
    { title: 'Codex: file (~/.codex/config.toml)', code: `[mcp_servers.moodle]\nurl = ${tomlString(url)}` },
    {
      title: 'Codex: command',
      code: `codex mcp add moodle --url ${url}`,
      note: 'Codex detects OAuth and opens the sign-in. Later, run codex mcp login moodle to sign in again.',
    },
  ];
}

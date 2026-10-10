import { SITE_HEADER, mcpEndpoint } from './constants';

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
  return JSON.stringify({ mcpServers: { moodle: { type: 'http', url: mcpEndpoint(), headers: connectionHeaders(details) } } }, null, 2);
}

/** Example for one specific agent, Claude Code. */
export function claudeCodeCommand(details: ConnectionDetails): string {
  const headers = Object.entries(connectionHeaders(details)).map(([k, v]) => `  --header "${k}: ${v}"`);
  return [`claude mcp add --transport http moodle ${mcpEndpoint()}`, ...headers].join(' \\\n');
}

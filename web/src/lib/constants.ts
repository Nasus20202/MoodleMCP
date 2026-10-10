/** Header that selects the Moodle site per request (see internal/server/site.go). */
export const SITE_HEADER = 'X-Moodle-URL';

/** Characters shown instead of the token while it is hidden. */
export const MASK = '•'.repeat(24);

export const TOKEN_PLACEHOLDER = '<your token>';

/** URL of the MCP endpoint of this deployment. */
export const mcpEndpoint = (): string => `${location.origin}/mcp`;

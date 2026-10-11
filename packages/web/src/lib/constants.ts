/** Characters shown instead of the token while it is hidden. */
export const MASK = '•'.repeat(24);

export const TOKEN_PLACEHOLDER = '<your token>';

/** URL of the MCP endpoint of this deployment. */
export const mcpEndpoint = (): string => `${location.origin}/mcp`;

/** Where the source lives, linked from the page footer. */
export const REPO_URL = 'https://github.com/Nasus20202/MoodleMCP';

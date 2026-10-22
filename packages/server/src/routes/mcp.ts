import { Hono } from 'hono';

import { authenticate } from '../http/auth.ts';
import { mcpClientFrom } from '../http/client-info.ts';
import type { AppEnv } from '../http/context.ts';
import type { Logger } from '../logger.ts';
import type { McpEndpoint } from '../mcp.ts';
import type { Sealer } from '../oauth/sealer.ts';
import type { SitePolicy } from '../site-policy.ts';
import { OAUTH_PATHS } from './oauth.ts';

/** The MCP endpoint, behind authentication. `sealer` is present when OAuth is enabled. */
export function mcpRoutes(deps: {
  endpoint: McpEndpoint;
  policy: SitePolicy;
  logger: Logger;
  sealer: Sealer | undefined;
}): Hono<AppEnv> {
  const { endpoint, policy, logger, sealer } = deps;
  return new Hono<AppEnv>().all('/mcp', async (c) => {
    const caller = await authenticate(c.req.raw.headers, {
      policy,
      sealer,
      resourceMetadataUrl: sealer
        ? `${new URL(c.req.url).origin}${OAUTH_PATHS.resourceMetadata}/mcp`
        : undefined,
    });
    if (c.req.method === 'POST') {
      const mcpClient = await c.req.raw
        .clone()
        .json()
        .then(mcpClientFrom, () => undefined);
      if (mcpClient) logger.info('mcp client initialized', { ...c.get('client'), ...mcpClient });
    }
    return endpoint.handle(c.req.raw, caller, { ...c.get('client') });
  });
}

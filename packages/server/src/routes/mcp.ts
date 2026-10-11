import { Hono } from 'hono';

import { authenticate } from '../http/auth.ts';
import type { AppEnv } from '../http/context.ts';
import type { McpEndpoint } from '../mcp.ts';
import type { Sealer } from '../oauth/sealer.ts';
import type { SitePolicy } from '../site-policy.ts';
import { OAUTH_PATHS } from './oauth.ts';

export function mcpRoutes(endpoint: McpEndpoint, policy: SitePolicy, sealer?: Sealer): Hono<AppEnv> {
  return new Hono<AppEnv>().all('/mcp', async (c) => {
    const caller = await authenticate(c.req.raw.headers, {
      policy,
      ...(sealer && {
        sealer,
        resourceMetadataUrl: `${new URL(c.req.url).origin}${OAUTH_PATHS.resourceMetadata}/mcp`,
      }),
    });
    return endpoint.handle(c.req.raw, caller, { ...c.get('client') });
  });
}

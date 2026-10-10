import { Hono } from 'hono';

import { authenticate } from '../http/auth.ts';
import type { AppEnv } from '../http/context.ts';
import type { McpEndpoint } from '../mcp.ts';
import type { SitePolicy } from '../site-policy.ts';

export function mcpRoutes(endpoint: McpEndpoint, policy: SitePolicy): Hono<AppEnv> {
  return new Hono<AppEnv>().all('/mcp', (c) =>
    endpoint.handle(c.req.raw, authenticate(c.req.raw.headers, policy), { ...c.get('client') }),
  );
}

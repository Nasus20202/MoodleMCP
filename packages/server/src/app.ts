import { Hono } from 'hono';

import type { AppConfig } from './config.ts';
import { clientInfo } from './http/client-info.ts';
import type { AppEnv } from './http/context.ts';
import { errorHandler } from './http/errors.ts';
import { requestLogger } from './http/request-logger.ts';
import { type Logger, silentLogger } from './logger.ts';
import { createMcpEndpoint } from './mcp.ts';
import { apiRoutes } from './routes/api.ts';
import { mcpRoutes } from './routes/mcp.ts';
import { SitePolicy } from './site-policy.ts';

export interface AppDeps {
  /** Outbound HTTP; replaced in tests. */
  fetch?: typeof fetch;
  logger?: Logger;
}

/** Builds the HTTP app: the MCP endpoint at /mcp and the setup page's API under /api. */
export function createApp(config: AppConfig, deps: AppDeps = {}): Hono<AppEnv> {
  const logger = deps.logger ?? silentLogger;
  const fetchImpl = deps.fetch ?? fetch.bind(globalThis);
  const policy = new SitePolicy(config);

  return new Hono<AppEnv>()
    .use(clientInfo())
    .use(requestLogger(logger))
    .route('/', mcpRoutes(createMcpEndpoint({ fetch: fetchImpl, logger }), policy))
    .route('/', apiRoutes({ policy, fetch: fetchImpl }))
    .onError(errorHandler(logger));
}

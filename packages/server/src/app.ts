import { Hono } from 'hono';

import type { AppConfig } from './config.ts';
import type { MarkdownConverter } from './files/markdown.ts';
import { clientInfo } from './http/client-info.ts';
import type { AppEnv } from './http/context.ts';
import { errorHandler, jsonError } from './http/errors.ts';
import { requestLogger } from './http/request-logger.ts';
import { type Logger, silentLogger } from './logger.ts';
import { createMcpEndpoint } from './mcp.ts';
import { Sealer } from './oauth/sealer.ts';
import { apiRoutes } from './routes/api.ts';
import { mcpRoutes } from './routes/mcp.ts';
import { oauthRoutes } from './routes/oauth.ts';
import { SitePolicy } from './site-policy.ts';

export interface AppDeps {
  /** Outbound HTTP; replaced in tests. */
  fetch?: typeof fetch;
  logger?: Logger;
  /** Workers AI's `toMarkdown`, from the AI binding; without it read_file always extracts text itself. */
  markdown?: MarkdownConverter | undefined;
}

/** Builds the HTTP app: the MCP endpoint at /mcp and the setup page's API under /api. */
export function createApp(config: AppConfig, deps: AppDeps = {}): Hono<AppEnv> {
  const logger = deps.logger ?? silentLogger;
  const fetchImpl = deps.fetch ?? fetch.bind(globalThis);
  const policy = new SitePolicy(config);
  const sealer = config.oauthSecret ? new Sealer(config.oauthSecret) : undefined;

  const app = new Hono<AppEnv>()
    .use(clientInfo())
    .use(requestLogger(logger))
    .route(
      '/',
      mcpRoutes(
        createMcpEndpoint({ fetch: fetchImpl, logger, markdown: deps.markdown }),
        policy,
        sealer,
        logger,
      ),
    )
    .route('/', apiRoutes({ policy, fetch: fetchImpl, oauth: sealer !== undefined }));
  if (sealer) app.route('/', oauthRoutes({ sealer, policy, fetch: fetchImpl, logger }));
  return app.notFound((c) => c.json(jsonError('Not found'), 404)).onError(errorHandler(logger));
}

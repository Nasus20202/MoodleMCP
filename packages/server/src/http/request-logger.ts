import type { MiddlewareHandler } from 'hono';

import type { Logger } from '../logger.ts';
import type { AppEnv } from './context.ts';

/** Logs method, path, status, duration and who called. Never headers, query strings or bodies. */
export function requestLogger(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = Date.now();
    await next();
    const { method, path } = c.req;
    const status = c.res.status;
    const ms = Date.now() - started;
    // The message is what dashboards show in the list view, so it carries the essentials.
    // Unknown paths are mostly crawlers, so they stay out of the default log level.
    const log = status === 404 ? 'debug' : 'info';
    logger[log](`${method} ${path} ${status} ${ms}ms`, { ...c.get('client'), method, path, status, ms });
  };
}

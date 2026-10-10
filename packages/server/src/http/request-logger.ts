import type { MiddlewareHandler } from 'hono';

import type { Logger } from '../logger.ts';
import type { AppEnv } from './context.ts';

/** Logs method, path, status, duration and who called. Never headers, query strings or bodies. */
export function requestLogger(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = Date.now();
    await next();
    logger.info('request', {
      ...c.get('client'),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    });
  };
}

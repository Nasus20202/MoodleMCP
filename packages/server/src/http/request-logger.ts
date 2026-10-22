import type { MiddlewareHandler } from 'hono';

import type { Logger } from '../logger.ts';
import type { AppEnv } from './context.ts';

/** Set by Cloudflare when Smart Placement is on: `remote-LHR` (placed near a data center) or `local-EWR`. */
export const PLACEMENT_HEADER = 'cf-placement';

const PLACEMENT = /^(local|remote)-[A-Z]{3}$/;

/** The placement value if it has the expected shape. Anything else is dropped, so a caller cannot write free text into logs. */
export function placementFrom(headers: Headers): string | undefined {
  const value = headers.get(PLACEMENT_HEADER);
  return value && PLACEMENT.test(value) ? value : undefined;
}

/** Logs method, path, status, duration and who called. Never headers, query strings or bodies. */
export function requestLogger(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = Date.now();
    await next();
    const { method, path } = c.req;
    const status = c.res.status;
    const ms = Date.now() - started;
    const placement = placementFrom(c.req.raw.headers);
    // The message is what dashboards show in the list view, so it carries the essentials.
    logger.info(`${method} ${path} ${status} ${ms}ms`, {
      ...c.get('client'),
      method,
      path,
      status,
      ms,
      ...(placement && { placement }),
    });
  };
}

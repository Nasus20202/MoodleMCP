import type { ErrorResponse } from '@moodle-mcp/shared';
import { LinkError } from '@moodle-mcp/shared';
import type { ErrorHandler } from 'hono';
import * as z from 'zod/v4';

import type { Logger } from '../logger.ts';
import { MoodleError, MoodleTransportError } from '../moodle/errors.ts';
import { SiteNotAllowedError } from '../site-policy.ts';
import type { AppEnv } from './context.ts';

/** An error with the HTTP status and message to return to the caller. */
export class HttpError extends Error {
  override name = 'HttpError';

  readonly status: 400 | 401 | 413 | 502;
  readonly headers: Record<string, string>;

  constructor(status: HttpError['status'], message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

export const jsonError = (message: string): ErrorResponse => ({ error: message });

/** Turns thrown errors into JSON error responses; unexpected ones are logged and reported opaquely. */
export function errorHandler(logger: Logger): ErrorHandler<AppEnv> {
  return (error, c) => {
    // These messages are fixed strings, so they are safe to log; they say why a caller was turned away.
    if (error instanceof HttpError && error.status === 401)
      logger.warn(`auth rejected: ${error.message}`, { ...c.get('client'), path: c.req.path });
    if (error instanceof HttpError && error.status === 413)
      logger.warn('request rejected: too large', { ...c.get('client'), path: c.req.path });
    if (error instanceof SiteNotAllowedError)
      logger.warn(`site rejected: ${error.message}`, { ...c.get('client'), path: c.req.path });
    if (error instanceof HttpError) return c.json(jsonError(error.message), error.status, error.headers);
    if (error instanceof LinkError || error instanceof SiteNotAllowedError)
      return c.json(jsonError(error.message), 400);
    if (error instanceof z.ZodError) return c.json(jsonError('Invalid request'), 400);
    if (error instanceof MoodleError || error instanceof MoodleTransportError)
      return c.json(jsonError(error.message), 502);

    logger.error('unhandled error', { path: c.req.path, error: String(error) });
    return c.json(jsonError('Internal error'), 500);
  };
}

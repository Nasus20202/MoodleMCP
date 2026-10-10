import { SITE_HEADER, TOKEN_HEADER } from '@moodle-mcp/shared';

import type { Caller } from '../mcp.ts';
import type { SitePolicy } from '../site-policy.ts';
import { HttpError } from './errors.ts';

const BEARER = /^bearer\s+(.+)$/i;

/** Extracts the Moodle token from `Authorization: Bearer …`, falling back to `X-Moodle-Token`. */
export function tokenFrom(headers: Headers): string {
  const bearer = BEARER.exec(headers.get('Authorization') ?? '')?.[1];
  return (bearer ?? headers.get(TOKEN_HEADER) ?? '').trim();
}

/** Resolves who is calling and which site they want. Throws HttpError when either is unusable. */
export function authenticate(headers: Headers, policy: SitePolicy): Caller {
  const token = tokenFrom(headers);
  if (!token) {
    throw new HttpError(401, 'Missing Moodle token: send "Authorization: Bearer <token>"', {
      'WWW-Authenticate': 'Bearer realm="moodle-mcp"',
    });
  }
  return { token, site: policy.resolve(headers.get(SITE_HEADER)) };
}

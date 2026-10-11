import { SITE_HEADER, TOKEN_HEADER } from '@moodle-mcp/shared';

import type { Caller } from '../mcp.ts';
import { Sealer } from '../oauth/sealer.ts';
import { accessSeal, SealKind } from '../oauth/types.ts';
import type { SitePolicy } from '../site-policy.ts';
import { HttpError } from './errors.ts';

const BEARER = /^bearer\s+(.+)$/i;

/** Extracts the credential from `Authorization: Bearer …`, falling back to `X-Moodle-Token`. */
export function tokenFrom(headers: Headers): string {
  const bearer = BEARER.exec(headers.get('Authorization') ?? '')?.[1];
  return (bearer ?? headers.get(TOKEN_HEADER) ?? '').trim();
}

export interface AuthOptions {
  policy: SitePolicy;
  /** Present when OAuth is enabled: lets callers present an access token instead of a raw Moodle token. */
  sealer?: Sealer;
  /** Where clients can discover how to sign in (RFC 9728); advertised on 401 when OAuth is enabled. */
  resourceMetadataUrl?: string;
}

/**
 * Resolves who is calling and which site they want. The credential is either a raw Moodle token (site from
 * the site header) or an OAuth access token issued by this server (site fixed inside it).
 * Throws HttpError when it is missing or unusable.
 */
export async function authenticate(headers: Headers, options: AuthOptions): Promise<Caller> {
  const { policy, sealer } = options;
  const credential = tokenFrom(headers);
  if (!credential) throw unauthorized(options, 'Missing Moodle token: send "Authorization: Bearer <token>"');

  if (sealer && Sealer.isSealed(credential)) {
    const grant = await sealer.open(SealKind.Access, credential, accessSeal);
    if (!grant) throw unauthorized(options, 'The access token is invalid or expired', 'invalid_token');
    return { token: grant.token, site: policy.validate(grant.site) };
  }
  return { token: credential, site: policy.resolve(headers.get(SITE_HEADER)) };
}

function unauthorized(options: AuthOptions, message: string, error?: string): HttpError {
  const params = [
    'realm="moodle-mcp"',
    ...(options.resourceMetadataUrl ? [`resource_metadata="${options.resourceMetadataUrl}"`] : []),
    ...(error ? [`error="${error}"`] : []),
  ];
  return new HttpError(401, message, { 'WWW-Authenticate': `Bearer ${params.join(', ')}` });
}

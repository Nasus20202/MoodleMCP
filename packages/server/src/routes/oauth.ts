import { classifyLink, decodeLaunchToken, LinkError, QRKind } from '@moodle-mcp/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import * as z from 'zod/v4';

import type { AppEnv } from '../http/context.ts';
import { HttpError } from '../http/errors.ts';
import type { Logger } from '../logger.ts';
import { MoodleClient } from '../moodle/client.ts';
import { MoodleError, MoodleTransportError } from '../moodle/errors.ts';
import { MoodleFunction } from '../moodle/functions.ts';
import { pkceChallenge, timingSafeEqualText } from '../oauth/encoding.ts';
import { consentPage, errorPage } from '../oauth/pages.ts';
import type { Sealer } from '../oauth/sealer.ts';
import { clientSeal, codeSeal, type Credentials, Lifetime, refreshSeal, SealKind } from '../oauth/types.ts';
import { SiteNotAllowedError, type SitePolicy } from '../site-policy.ts';

export const OAUTH_PATHS = {
  authorize: '/oauth/authorize',
  token: '/oauth/token',
  register: '/oauth/register',
  resourceMetadata: '/.well-known/oauth-protected-resource',
  serverMetadata: '/.well-known/oauth-authorization-server',
} as const;

const MAX_REDIRECT_URIS = 10;
/** Registration, consent and token requests are small forms or JSON; anything bigger is refused unread. */
const MAX_BODY_BYTES = 16 * 1024;
const limitBody = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: () => {
    throw new HttpError(413, 'Request too large');
  },
});
const HTML_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
} as const;

/** Redirect targets must be https, or plain http on the loopback interface (native and desktop clients). */
function isValidRedirectUri(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.hash) return false;
    return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname));
  } catch {
    return false;
  }
}

const isLoopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

const registrationRequest = z.object({
  redirect_uris: z.array(z.string().refine(isValidRedirectUri)).min(1).max(MAX_REDIRECT_URIS),
  client_name: z.string().max(200).optional(),
});

const authorizeRequest = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  code_challenge: z.string().regex(/^[\w-]{43,128}$/),
  code_challenge_method: z.literal('S256'),
  state: z.string().max(2048).optional(),
});
type AuthorizeRequest = z.output<typeof authorizeRequest>;

const consentSubmission = authorizeRequest.extend({ site: z.string().min(1), token: z.string().min(1) });

const tokenRequest = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string().min(1),
    redirect_uri: z.string().min(1),
    code_verifier: z.string().regex(/^[\w.~-]{43,128}$/),
    client_id: z.string().optional(),
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string().min(1),
    client_id: z.string().optional(),
  }),
]);

/** An RFC 6749 error response. */
class GrantError extends Error {
  override name = 'GrantError';
  readonly code: string;
  readonly status: 400 | 401;

  constructor(code: string, description: string, status: 400 | 401 = 400) {
    super(description);
    this.code = code;
    this.status = status;
  }
}

/**
 * A minimal, stateless OAuth 2.1 authorization server for MCP clients that cannot send a static header
 * (e.g. ChatGPT). The "login" is pasting a Moodle token; everything issued is a sealed blob that carries
 * that token, so nothing is stored. See `oauth/sealer.ts`.
 */
export function oauthRoutes(deps: {
  sealer: Sealer;
  policy: SitePolicy;
  fetch: typeof fetch;
  logger: Logger;
}): Hono<AppEnv> {
  const { sealer, policy, logger } = deps;
  const origin = (url: string) => new URL(url).origin;

  const openClient = async (clientId: string) => sealer.open(SealKind.Client, clientId, clientSeal);

  /** Checks the client and redirect URI of an authorization request; those errors must never redirect. */
  async function validateRequest(request: AuthorizeRequest): Promise<string> {
    const client = await openClient(request.client_id);
    if (!client) throw new GrantError('invalid_client', 'Unknown client. Remove and re-add the connector.');
    if (!client.redirectUris.includes(request.redirect_uri))
      throw new GrantError('invalid_request', 'The redirect address is not registered for this client.');
    return new URL(request.redirect_uri).host;
  }

  async function issueTokens(credentials: Credentials, clientId: string) {
    return {
      access_token: await sealer.seal(SealKind.Access, credentials, Lifetime.Access),
      token_type: 'Bearer',
      expires_in: Lifetime.Access,
      refresh_token: await sealer.seal(SealKind.Refresh, { ...credentials, clientId }, Lifetime.Refresh),
    };
  }

  async function redeem(body: z.output<typeof tokenRequest>) {
    if (body.grant_type === 'refresh_token') {
      const grant = await sealer.open(SealKind.Refresh, body.refresh_token, refreshSeal);
      if (!grant) throw new GrantError('invalid_grant', 'The refresh token is invalid or expired');
      if (body.client_id && body.client_id !== grant.clientId)
        throw new GrantError('invalid_grant', 'The refresh token was issued to another client');
      return issueTokens({ token: grant.token, site: grant.site }, grant.clientId);
    }

    const grant = await sealer.open(SealKind.Code, body.code, codeSeal);
    if (!grant) throw new GrantError('invalid_grant', 'The authorization code is invalid or expired');
    if (body.redirect_uri !== grant.redirectUri || (body.client_id && body.client_id !== grant.clientId))
      throw new GrantError('invalid_grant', 'The code was issued for a different client or redirect');
    if (!(await timingSafeEqualText(await pkceChallenge(body.code_verifier), grant.challenge)))
      throw new GrantError('invalid_grant', 'PKCE verification failed');
    return issueTokens({ token: grant.token, site: grant.site }, grant.clientId);
  }

  return new Hono<AppEnv>()
    .use('/.well-known/*', cors())
    .use('/oauth/register', cors())
    .use('/oauth/token', cors())
    .post('/oauth/*', limitBody)
    .get('/.well-known/oauth-protected-resource/*', (c) => c.json(protectedResource(origin(c.req.url))))
    .get(OAUTH_PATHS.resourceMetadata, (c) => c.json(protectedResource(origin(c.req.url))))
    .get('/.well-known/oauth-authorization-server/*', (c) => c.json(serverMetadata(origin(c.req.url))))
    .get(OAUTH_PATHS.serverMetadata, (c) => c.json(serverMetadata(origin(c.req.url))))
    .post(OAUTH_PATHS.register, async (c) => {
      const parsed = registrationRequest.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) {
        logger.warn('oauth register rejected: invalid redirect_uris', { ...c.get('client') });
        return c.json(
          {
            error: 'invalid_redirect_uri',
            error_description: 'redirect_uris must be https (or loopback http) URLs',
          },
          400,
        );
      }
      const clientId = await sealer.seal(SealKind.Client, { redirectUris: parsed.data.redirect_uris });
      logger.info('oauth client registered', { ...c.get('client') });
      return c.json(
        {
          client_id: clientId,
          client_name: parsed.data.client_name,
          redirect_uris: parsed.data.redirect_uris,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
        201,
        { 'Cache-Control': 'no-store' },
      );
    })
    .get(OAUTH_PATHS.authorize, async (c) => {
      const parsed = authorizeRequest.safeParse(c.req.query());
      if (!parsed.success) return c.html(errorPage('Invalid authorization request.'), 400, HTML_HEADERS);
      try {
        const redirectHost = await validateRequest(parsed.data);
        return c.html(
          consentPage({
            fields: parsed.data as Record<string, string>,
            redirectHost,
            defaultSite: policy.defaultUrl,
          }),
          200,
          HTML_HEADERS,
        );
      } catch (error) {
        if (error instanceof GrantError) return c.html(errorPage(error.message), 400, HTML_HEADERS);
        throw error;
      }
    })
    .post(OAUTH_PATHS.authorize, async (c) => {
      const form = Object.fromEntries(
        Object.entries(await c.req.parseBody()).filter(([, v]) => typeof v === 'string'),
      );
      const parsed = consentSubmission.safeParse(form);
      if (!parsed.success) return c.html(errorPage('Invalid authorization request.'), 400, HTML_HEADERS);
      const { site: requestedSite, token: rawToken, ...request } = parsed.data;

      let redirectHost: string;
      try {
        redirectHost = await validateRequest(request);
      } catch (error) {
        if (error instanceof GrantError) return c.html(errorPage(error.message), 400, HTML_HEADERS);
        throw error;
      }

      const retry = (reason: string, message: string, site?: string) => {
        logger.warn(`oauth consent rejected: ${reason}`, { ...c.get('client'), redirectHost, site });
        return c.html(
          consentPage({
            fields: request as Record<string, string>,
            redirectHost,
            defaultSite: requestedSite,
            error: message,
          }),
          400,
          HTML_HEADERS,
        );
      };

      let token: string;
      try {
        token = tokenFromInput(rawToken);
      } catch (error) {
        if (error instanceof LinkError) return retry('bad_token', error.message);
        throw error;
      }

      let site: string;
      try {
        site = policy.validate(requestedSite);
      } catch (error) {
        if (error instanceof SiteNotAllowedError) return retry('site_not_allowed', error.message);
        throw error;
      }
      try {
        await new MoodleClient({ baseUrl: site, token, fetch: deps.fetch, logger }).call(
          MoodleFunction.SiteInfo,
        );
      } catch (error) {
        if (error instanceof MoodleError)
          return retry('moodle_rejected', 'Moodle rejected this token. Check it and the site.', site);
        if (error instanceof MoodleTransportError)
          return retry('moodle_unreachable', 'Could not reach that Moodle site.', site);
        throw error;
      }

      const code = await sealer.seal(
        SealKind.Code,
        {
          token,
          site,
          clientId: request.client_id,
          redirectUri: request.redirect_uri,
          challenge: request.code_challenge,
        },
        Lifetime.Code,
      );
      logger.info('oauth code issued', { ...c.get('client'), redirectHost, site });
      const target = new URL(request.redirect_uri);
      target.searchParams.set('code', code);
      if (request.state !== undefined) target.searchParams.set('state', request.state);
      return c.redirect(target.toString(), 302);
    })
    .post(OAUTH_PATHS.token, async (c) => {
      c.header('Cache-Control', 'no-store');
      try {
        const body = tokenRequest.safeParse(await c.req.parseBody());
        if (!body.success)
          throw new GrantError('invalid_request', 'Missing or invalid parameters for this grant type');
        const tokens = await redeem(body.data);
        logger.info(`oauth token issued (${body.data.grant_type})`, { ...c.get('client') });
        return c.json(tokens);
      } catch (error) {
        if (!(error instanceof GrantError)) throw error;
        logger.warn(`oauth token rejected: ${error.code}`, { ...c.get('client'), reason: error.message });
        return c.json({ error: error.code, error_description: error.message }, error.status);
      }
    });
}

const protectedResource = (base: string) => ({
  resource: `${base}/mcp`,
  authorization_servers: [base],
  bearer_methods_supported: ['header'],
});

const serverMetadata = (base: string) => ({
  issuer: base,
  authorization_endpoint: `${base}${OAUTH_PATHS.authorize}`,
  token_endpoint: `${base}${OAUTH_PATHS.token}`,
  registration_endpoint: `${base}${OAUTH_PATHS.register}`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
});

/** Accepts a raw token, or the moodlemobile://token=… link Moodle shows after a browser sign-in. */
function tokenFromInput(input: string): string {
  const text = input.trim();
  switch (classifyLink(text)) {
    case QRKind.Token:
      return decodeLaunchToken(text);
    case QRKind.Unknown:
      return text;
    default:
      throw new LinkError('That is a Moodle app link without a token. Paste the token itself.');
  }
}

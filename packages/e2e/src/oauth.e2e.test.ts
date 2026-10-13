import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { McpClient, rpc, textOf } from './mcp.ts';
import { ALICE, BOB, COURSE_DB, OTHER_SITE_URL, OTHER_SITE_USER, SITE_URL } from './mock/data.ts';
import { OAUTH_SECRET } from './worker.ts';
import { useWorld, type World } from './world.ts';

const REDIRECT = 'https://chat.example.com/callback';
const VERIFIER = 'v'.repeat(64);
const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

const form = (fields: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields),
});

const register = async (world: World, redirectUris = [REDIRECT]): Promise<string> => {
  const res = await world.worker.fetch('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: redirectUris, client_name: 'E2E client' }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
};

const authorizeParams = (
  clientId: string,
  overrides: Record<string, string> = {},
): Record<string, string> => ({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: REDIRECT,
  code_challenge: challengeOf(VERIFIER),
  code_challenge_method: 'S256',
  state: 'state-123',
  ...overrides,
});

/** Submits the consent form, as the user's browser does after pasting a token. */
const consent = (world: World, clientId: string, fields: Record<string, string> = {}) =>
  world.worker.fetch(
    '/oauth/authorize',
    form({ ...authorizeParams(clientId), site: SITE_URL, token: ALICE.token, ...fields }),
  );

const codeFrom = (res: Response): string => {
  expect(res.status).toBe(302);
  return new URL(res.headers.get('Location') ?? '').searchParams.get('code') ?? '';
};

const redeem = async (world: World, fields: Record<string, string>) => {
  const res = await world.worker.fetch('/oauth/token', form(fields));
  return {
    status: res.status,
    headers: res.headers,
    body: (await res.json()) as Tokens & { error?: string },
  };
};

/** Registers, consents and redeems the code: what a connector such as ChatGPT does. */
async function signIn(world: World, fields: Record<string, string> = {}) {
  const clientId = await register(world);
  const code = codeFrom(await consent(world, clientId, fields));
  const { body } = await redeem(world, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    code_verifier: VERIFIER,
    client_id: clientId,
  });
  return { clientId, code, tokens: body };
}

describe('OAuth enabled', () => {
  const world = useWorld({ OAUTH_SECRET, ALLOWED_MOODLE_HOSTS: '*' });

  describe('discovery', () => {
    it('serves the protected resource metadata, which points to this server', async () => {
      for (const path of [
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/mcp',
      ]) {
        const res = await world.worker.fetch(path);
        expect(res.status, path).toBe(200);
        expect(await res.json()).toEqual({
          resource: `${world.worker.origin}/mcp`,
          authorization_servers: [world.worker.origin],
          bearer_methods_supported: ['header'],
        });
      }
    });

    it('serves the authorization server metadata with PKCE S256 and public clients only', async () => {
      for (const path of [
        '/.well-known/oauth-authorization-server',
        '/.well-known/oauth-authorization-server/mcp',
      ]) {
        const res = await world.worker.fetch(path);
        expect(await res.json(), path).toMatchObject({
          issuer: world.worker.origin,
          authorization_endpoint: `${world.worker.origin}/oauth/authorize`,
          token_endpoint: `${world.worker.origin}/oauth/token`,
          registration_endpoint: `${world.worker.origin}/oauth/register`,
          code_challenge_methods_supported: ['S256'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          token_endpoint_auth_methods_supported: ['none'],
        });
      }
    });

    it('lets browser-based clients read the metadata and call the token and registration endpoints (CORS)', async () => {
      const meta = await world.worker.fetch('/.well-known/oauth-authorization-server', {
        headers: { Origin: 'https://app.example.com' },
      });
      expect(meta.headers.get('Access-Control-Allow-Origin')).toBe('*');
      const preflight = await world.worker.fetch('/oauth/token', {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example.com', 'Access-Control-Request-Method': 'POST' },
      });
      expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('tells an unauthenticated MCP client where to sign in', async () => {
      const reply = await rpc(world.worker, {}, 'tools/list');
      expect(reply.status).toBe(401);
      expect(reply.headers.get('WWW-Authenticate')).toContain(
        `resource_metadata="${world.worker.origin}/.well-known/oauth-protected-resource/mcp"`,
      );
    });

    it('is reported to the setup page', async () => {
      expect(await (await world.worker.fetch('/api/config')).json()).toMatchObject({ oauth: true });
    });
  });

  describe('dynamic client registration', () => {
    it('registers a public client whose id carries its redirect addresses', async () => {
      const res = await world.worker.fetch('/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [REDIRECT, 'http://127.0.0.1:33418/cb'], client_name: 'Desk' }),
      });
      expect(res.status).toBe(201);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await res.json()).toMatchObject({
        client_name: 'Desk',
        redirect_uris: [REDIRECT, 'http://127.0.0.1:33418/cb'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
      });
    });

    it.each([
      ['no redirect addresses', []],
      ['plain http to a remote host', ['http://evil.example/cb']],
      ['a custom scheme', ['javascript:alert(1)']],
      ['a fragment', ['https://a.example/cb#frag']],
      ['something that is not a URL', ['not a url']],
      ['too many addresses', Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`)],
    ])('rejects %s', async (_name, redirect_uris) => {
      const res = await world.worker.fetch('/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_uris }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_redirect_uri' });
    });

    it('rejects a body that is not JSON', async () => {
      const res = await world.worker.fetch('/oauth/register', { method: 'POST', body: 'nope' });
      expect(res.status).toBe(400);
    });
  });

  describe('the consent page', () => {
    it('shows who is asking and where the user would be sent, and explains how to get a token', async () => {
      const clientId = await register(world);
      const res = await world.worker.fetch(
        `/oauth/authorize?${new URLSearchParams(authorizeParams(clientId)).toString()}`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const page = await res.text();
      expect(page).toContain('chat.example.com');
      expect(page).toContain(SITE_URL);
      expect(page).toContain('How do I get my token?');
      expect(page).toContain(`${SITE_URL}/admin/tool/mobile/launch.php?`);
    });

    it('does not contact Moodle just to show the page', async () => {
      const clientId = await register(world);
      await world.worker.fetch(
        `/oauth/authorize?${new URLSearchParams(authorizeParams(clientId)).toString()}`,
      );
      expect(world.network.sites.flatMap((s) => s.requests)).toHaveLength(0);
    });

    it.each([
      ['an unknown client', { client_id: 'mm1.bogus.bogus' }],
      ['a redirect address that was not registered', { redirect_uri: 'https://attacker.example/cb' }],
      ['PKCE method "plain"', { code_challenge_method: 'plain' }],
      ['a response type other than code', { response_type: 'token' }],
      ['a malformed challenge', { code_challenge: 'short' }],
    ])('refuses %s with an error page and never redirects', async (_name, override) => {
      const clientId = await register(world);
      const params = authorizeParams(clientId, override);
      const get = await world.worker.fetch(`/oauth/authorize?${new URLSearchParams(params).toString()}`);
      expect(get.status).toBe(400);
      expect(get.headers.get('Location')).toBeNull();
      const post = await world.worker.fetch(
        '/oauth/authorize',
        form({ ...params, site: SITE_URL, token: ALICE.token }),
      );
      expect(post.status).toBe(400);
      expect(post.headers.get('Location')).toBeNull();
      expect(world.network.sites.flatMap((s) => s.requests)).toHaveLength(0);
    });
  });

  describe('consent submission', () => {
    it('checks the token with Moodle, then redirects back with a code and the original state', async () => {
      const clientId = await register(world);
      const res = await consent(world, clientId);
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('Location') ?? '');
      expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
      expect(location.searchParams.get('state')).toBe('state-123');
      expect(location.searchParams.get('code')).toBeTruthy();
      expect(location.searchParams.get('code')).not.toContain(ALICE.token);
      expect(world.moodle.restCalls.map((r) => r.fn)).toEqual(['core_webservice_get_site_info']);
      expect(world.moodle.restCalls[0]?.token).toBe(ALICE.token);
    });

    it('omits state when the client sent none', async () => {
      const clientId = await register(world);
      const { state: _state, ...withoutState } = authorizeParams(clientId);
      const res = await world.worker.fetch(
        '/oauth/authorize',
        form({ ...withoutState, site: SITE_URL, token: ALICE.token }),
      );
      expect(new URL(res.headers.get('Location') ?? '').searchParams.has('state')).toBe(false);
    });

    it('accepts the moodlemobile://token=… link Moodle shows after a browser sign-in', async () => {
      const link = `moodlemobile://token=${Buffer.from(`site-id:::${ALICE.token}:::private`).toString('base64')}`;
      const clientId = await register(world);
      expect(codeFrom(await consent(world, clientId, { token: link }))).toBeTruthy();
      expect(world.moodle.restCalls[0]?.token).toBe(ALICE.token);
    });

    it('rejects a Moodle app link that carries no token', async () => {
      const clientId = await register(world);
      const res = await consent(world, clientId, {
        token: 'moodlemobile://moodle.example.edu?qrlogin=k&userid=1',
      });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('without a token');
      expect(world.moodle.requests).toHaveLength(0);
    });

    it('asks again, without issuing a code, when Moodle rejects the token', async () => {
      const clientId = await register(world);
      const res = await consent(world, clientId, { token: 'wrong-token' });
      expect(res.status).toBe(400);
      expect(res.headers.get('Location')).toBeNull();
      const page = await res.text();
      expect(page).toContain('Moodle rejected this token');
      // The page offers the form again but never echoes the secret back.
      expect(page).not.toContain('wrong-token');
    });

    it('says so when the Moodle site cannot be reached', async () => {
      world.moodle.down = true;
      const res = await consent(world, await register(world));
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Could not reach that Moodle site');
    });

    it('refuses a site the policy forbids, without contacting it', async () => {
      const clientId = await register(world);
      for (const site of ['http://moodle.example.edu/2025', 'https://127.0.0.1/moodle', 'not a site']) {
        const res = await consent(world, clientId, { site });
        expect(res.status, site).toBe(400);
        expect(res.headers.get('Location')).toBeNull();
      }
      expect(world.network.sites.flatMap((s) => s.requests)).toHaveLength(0);
      expect(world.network.stray).toEqual([]);
    });

    it('binds the grant to the site the user chose', async () => {
      const { tokens } = await signIn(world, { site: OTHER_SITE_URL, token: OTHER_SITE_USER.token });
      const info = await McpClient.bearer(world.worker, tokens.access_token).json<{ userid: number }>(
        'get_site_info',
      );
      expect(info.userid).toBe(OTHER_SITE_USER.id);
      expect(world.moodle.restCalls).toHaveLength(0);
    });

    it('refuses an oversized form', async () => {
      const res = await world.worker.fetch('/oauth/authorize', form({ token: 'x'.repeat(20_000) }));
      expect(res.status).toBe(413);
    });
  });

  describe('token endpoint', () => {
    it('issues sealed tokens that do not contain the Moodle token', async () => {
      const { tokens } = await signIn(world);
      expect(tokens.token_type).toBe('Bearer');
      expect(tokens.expires_in).toBeGreaterThan(0);
      for (const token of [tokens.access_token, tokens.refresh_token]) {
        expect(token).toMatch(/^mm1\./);
        expect(token).not.toContain(ALICE.token);
        expect(Buffer.from(token, 'base64url').toString('latin1')).not.toContain(ALICE.token);
      }
      expect(tokens.access_token).not.toBe(tokens.refresh_token);
    });

    it('is never cached', async () => {
      const clientId = await register(world);
      const res = await redeem(world, {
        grant_type: 'authorization_code',
        code: 'x',
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
        client_id: clientId,
      });
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    it.each([
      ['a wrong PKCE verifier', { code_verifier: 'w'.repeat(64) }],
      ['another redirect address', { redirect_uri: 'https://attacker.example/cb' }],
      ['another client id', { client_id: 'someone-else' }],
      ['a garbage code', { code: 'mm1.garbage.garbage' }],
    ])(
      'refuses %s with invalid_grant, and still honours the genuine request afterwards',
      async (_name, override) => {
        const clientId = await register(world);
        const code = codeFrom(await consent(world, clientId));
        const good = {
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT,
          code_verifier: VERIFIER,
          client_id: clientId,
        };
        const bad = await redeem(world, { ...good, ...override });
        expect(bad.status).toBe(400);
        expect(bad.body.error).toBe('invalid_grant');
        expect((await redeem(world, good)).status).toBe(200);
      },
    );

    it('does not accept a refresh token or access token where a code belongs', async () => {
      const { clientId, tokens } = await signIn(world);
      for (const code of [tokens.refresh_token, tokens.access_token]) {
        const res = await redeem(world, {
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT,
          code_verifier: VERIFIER,
          client_id: clientId,
        });
        expect(res.status).toBe(400);
      }
    });

    it.each([
      ['an unknown grant type', { grant_type: 'password', username: 'a', password: 'b' }],
      ['a code grant without a code', { grant_type: 'authorization_code', redirect_uri: REDIRECT }],
      [
        'a verifier that is too short',
        { grant_type: 'authorization_code', code: 'x', redirect_uri: REDIRECT, code_verifier: 'short' },
      ],
      ['a refresh grant without a token', { grant_type: 'refresh_token' }],
    ])('answers %s with invalid_request', async (_name, fields) => {
      const res = await redeem(world, fields);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
    });
  });

  describe('using the access token on /mcp', () => {
    it('serves every call as the user who signed in, with the Moodle token inside the grant', async () => {
      const { tokens } = await signIn(world);
      const client = McpClient.bearer(world.worker, tokens.access_token);

      expect((await client.listTools()).length).toBeGreaterThan(20);
      const courses = await client.json<{ id: number }[]>('list_courses');
      expect(courses.map((c) => c.id)).toContain(COURSE_DB);
      for (const call of world.moodle.restCalls.slice(1)) expect(call.token).toBe(ALICE.token);
      expect(world.moodle.restCalls[0]?.url.href.startsWith(SITE_URL)).toBe(true);
    });

    it('keeps users apart: two sign-ins, two identities', async () => {
      const [a, b] = [await signIn(world), await signIn(world, { token: BOB.token })];
      const who = (tokens: Tokens) =>
        McpClient.bearer(world.worker, tokens.access_token).json<{ userid: number }>('get_site_info');
      const results = await Promise.all([who(a.tokens), who(b.tokens), who(a.tokens), who(b.tokens)]);
      expect(results.map((r) => r.userid)).toEqual([ALICE.id, BOB.id, ALICE.id, BOB.id]);
    });

    it('works as X-Moodle-Token too, and ignores a site header (the grant fixes the site)', async () => {
      const { tokens } = await signIn(world);
      const reply = await rpc(
        world.worker,
        { 'X-Moodle-Token': tokens.access_token, 'X-Moodle-URL': OTHER_SITE_URL },
        'tools/call',
        {
          name: 'get_site_info',
          arguments: {},
        },
      );
      expect(reply.status).toBe(200);
      expect(world.other.requests).toHaveLength(0);
      expect(world.moodle.restCalls).toHaveLength(2);
    });

    it('reads files with the Moodle token from the grant', async () => {
      const { tokens } = await signIn(world);
      const result = await McpClient.bearer(world.worker, tokens.access_token).call('read_file', {
        file_url: `${SITE_URL}/webservice/pluginfile.php/301/mod_resource/content/1/notes.txt`,
      });
      expect(textOf(result)).toContain('Big-O notes');
      expect(world.moodle.requests.at(-1)).toMatchObject({ kind: 'file', token: ALICE.token });
    });

    it('answers 401 invalid_token for a tampered or foreign access token', async () => {
      const { tokens } = await signIn(world);
      world.network.reset();
      const flipped = `${tokens.access_token.slice(0, -2)}${tokens.access_token.endsWith('AA') ? 'BB' : 'AA'}`;
      for (const token of [flipped, 'mm1.not.valid', tokens.refresh_token]) {
        const reply = await rpc(world.worker, { Authorization: `Bearer ${token}` }, 'tools/list');
        expect(reply.status, token).toBe(401);
        expect(reply.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
        expect(reply.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
      }
      expect(world.network.sites.flatMap((s) => s.requests)).toHaveLength(0);
    });

    it('stops working with Moodle’s answer once the Moodle token is revoked', async () => {
      const { tokens } = await signIn(world);
      world.moodle.revoke(ALICE.token);
      const result = await McpClient.bearer(world.worker, tokens.access_token).call('get_site_info');
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('invalidtoken');
    });

    it('still accepts raw Moodle tokens next to OAuth', async () => {
      const reply = await rpc(world.worker, { Authorization: `Bearer ${ALICE.token}` }, 'tools/list');
      expect(reply.status).toBe(200);
    });
  });

  describe('refreshing', () => {
    it('exchanges a refresh token for fresh tokens that serve the same user', async () => {
      const { clientId, tokens } = await signIn(world);
      const refreshed = await redeem(world, {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      });
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.access_token).toBeTruthy();
      expect(refreshed.body.refresh_token).toBeTruthy();
      const info = await McpClient.bearer(world.worker, refreshed.body.access_token).json<{ userid: number }>(
        'get_site_info',
      );
      expect(info.userid).toBe(ALICE.id);

      // Refresh tokens rotate forward: the new one works too.
      const again = await redeem(world, {
        grant_type: 'refresh_token',
        refresh_token: refreshed.body.refresh_token,
      });
      expect(again.status).toBe(200);
    });

    it('works without sending the client id', async () => {
      const { tokens } = await signIn(world);
      expect(
        (await redeem(world, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).status,
      ).toBe(200);
    });

    it('refuses a refresh token presented by another client', async () => {
      const { tokens } = await signIn(world);
      const other = await register(world);
      const res = await redeem(world, {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: other,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    it('refuses an access token or a garbage value as a refresh token', async () => {
      const { tokens } = await signIn(world);
      for (const refresh_token of [tokens.access_token, 'mm1.garbage.garbage', 'x']) {
        const res = await redeem(world, { grant_type: 'refresh_token', refresh_token });
        expect(res.status, refresh_token).toBe(400);
        expect(res.body.error).toBe('invalid_grant');
      }
    });
  });

  describe('the whole journey, as a connector sees it', () => {
    it('401 → discovery → registration → consent → token → tool call → refresh → tool call', async () => {
      const challenge = await rpc(world.worker, {}, 'tools/list');
      expect(challenge.status).toBe(401);
      const metadataUrl =
        /resource_metadata="([^"]+)"/.exec(challenge.headers.get('WWW-Authenticate') ?? '')?.[1] ?? '';

      const resource = (await (await world.worker.fetch(new URL(metadataUrl).pathname)).json()) as {
        authorization_servers: string[];
      };
      const serverUrl = new URL('/.well-known/oauth-authorization-server', resource.authorization_servers[0]);
      const meta = (await (await world.worker.fetch(serverUrl.pathname)).json()) as Record<string, string>;
      const endpoint = (url: string | undefined) => new URL(url ?? '').pathname;

      const registered = (await (
        await world.worker.fetch(endpoint(meta.registration_endpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ redirect_uris: [REDIRECT] }),
        })
      ).json()) as { client_id: string };

      const page = await world.worker.fetch(
        `${endpoint(meta.authorization_endpoint)}?${new URLSearchParams(authorizeParams(registered.client_id)).toString()}`,
      );
      expect(page.status).toBe(200);
      const redirected = await world.worker.fetch(
        endpoint(meta.authorization_endpoint),
        form({ ...authorizeParams(registered.client_id), site: SITE_URL, token: ALICE.token }),
      );
      const code = codeFrom(redirected);

      const issued = (await (
        await world.worker.fetch(
          endpoint(meta.token_endpoint),
          form({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT,
            code_verifier: VERIFIER,
            client_id: registered.client_id,
          }),
        )
      ).json()) as Tokens;
      expect(
        (await McpClient.bearer(world.worker, issued.access_token).json<{ userid: number }>('get_site_info'))
          .userid,
      ).toBe(ALICE.id);

      const renewed = (await (
        await world.worker.fetch(
          endpoint(meta.token_endpoint),
          form({ grant_type: 'refresh_token', refresh_token: issued.refresh_token }),
        )
      ).json()) as Tokens;
      expect(
        (await McpClient.bearer(world.worker, renewed.access_token).json<{ userid: number }>('get_site_info'))
          .userid,
      ).toBe(ALICE.id);
    });
  });
});

describe('OAuth disabled (no OAUTH_SECRET)', () => {
  const world = useWorld({ ALLOWED_MOODLE_HOSTS: '*' });

  it.each([
    ['GET', '/.well-known/oauth-authorization-server'],
    ['GET', '/.well-known/oauth-protected-resource'],
    ['POST', '/oauth/register'],
    ['GET', '/oauth/authorize'],
    ['POST', '/oauth/authorize'],
    ['POST', '/oauth/token'],
  ])('does not serve %s %s', async (method, path) => {
    const res = await world.worker.fetch(path, { method });
    expect(res.status).toBe(404);
  });

  it('reports OAuth as off to the setup page', async () => {
    expect(await (await world.worker.fetch('/api/config')).json()).toMatchObject({ oauth: false });
  });
});

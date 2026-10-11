import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.ts';
import { createLogger } from '../logger.ts';
import { fakeMoodle, type RecordedCall, TEST_SITE, testConfig } from '../test-utils.ts';
import { pkceChallenge } from './encoding.ts';

const SECRET = 'a-secret-that-is-at-least-32-characters-long';
const ORIGIN = 'https://mcp.example.com';
const REDIRECT = 'https://chatgpt.example/callback';
const VERIFIER = 'v'.repeat(64);
const MOODLE_TOKEN = 'moodle-token-123';

function setup(respond: (call: RecordedCall) => unknown = () => ({ userid: 1 }), oauth = true) {
  const moodle = fakeMoodle(respond);
  const logs: string[] = [];
  const logger = createLogger('debug', (_l, line) => logs.push(line));
  const app = createApp(testConfig(oauth ? { oauthSecret: SECRET } : {}), { fetch: moodle.fetch, logger });
  const request = (path: string, init?: RequestInit) => app.request(`${ORIGIN}${path}`, init);
  return { app, moodle, logs, request };
}

type Harness = ReturnType<typeof setup>;

const form = (fields: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields),
});

async function register(h: Harness, redirectUris = [REDIRECT]): Promise<string> {
  const res = await h.request('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: redirectUris, client_name: 'ChatGPT' }),
  });
  expect(res.status).toBe(201);
  return (await res.json<{ client_id: string }>()).client_id;
}

async function authorizeParams(clientId: string, redirectUri = REDIRECT) {
  return {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: await pkceChallenge(VERIFIER),
    code_challenge_method: 'S256',
    state: 'xyz',
  };
}

/** Runs register → authorize and returns the client id and the authorization code. */
async function obtainCode(h: Harness, token = MOODLE_TOKEN) {
  const clientId = await register(h);
  const params = await authorizeParams(clientId);
  const res = await h.request('/oauth/authorize', form({ ...params, site: TEST_SITE, token }));
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('Location') ?? '');
  expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
  expect(location.searchParams.get('state')).toBe('xyz');
  return { clientId, code: location.searchParams.get('code') ?? '' };
}

interface TokenReply {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  error?: string;
}

const exchange = async (h: Harness, fields: Record<string, string>) => {
  const res = await h.request('/oauth/token', form(fields));
  return { status: res.status, body: await res.json<TokenReply>() };
};

describe('OAuth discovery', () => {
  it('advertises the endpoints', async () => {
    const h = setup();
    const resource = await (await h.request('/.well-known/oauth-protected-resource/mcp')).json();
    expect(resource).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });

    const server = await (await h.request('/.well-known/oauth-authorization-server')).json();
    expect(server).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('points unauthenticated MCP calls at the metadata', async () => {
    const res = await setup().request('/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it('is off without a secret', async () => {
    const h = setup(undefined, false);
    expect((await h.request('/.well-known/oauth-authorization-server')).status).toBe(404);
    expect((await h.request('/oauth/register', { method: 'POST' })).status).toBe(404);
    const res = await h.request('/mcp', { method: 'POST', body: '{}' });
    expect(res.headers.get('WWW-Authenticate')).not.toContain('resource_metadata');
  });
});

describe('client registration', () => {
  it.each([[[]], [['http://evil.example/cb']], [['not a url']], [['https://a.example/cb#frag']]])(
    'rejects redirect URIs %j',
    async (uris) => {
      const res = await setup().request('/oauth/register', {
        method: 'POST',
        body: JSON.stringify({ redirect_uris: uris }),
      });
      expect(res.status).toBe(400);
    },
  );

  it('accepts loopback http for native clients', async () => {
    expect(await register(setup(), ['http://127.0.0.1:33418/cb'])).toMatch(/^mm1\./);
  });
});

describe('authorization', () => {
  it('shows the consent page for a registered client', async () => {
    const h = setup();
    const params = new URLSearchParams(await authorizeParams(await register(h)));
    const res = await h.request(`/oauth/authorize?${params.toString()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    const page = await res.text();
    expect(page).toContain('chatgpt.example');
    expect(page).toContain(TEST_SITE);
  });

  it('explains how to get a token, with a sign-in link for the site', async () => {
    const h = setup();
    const params = new URLSearchParams(await authorizeParams(await register(h)));
    const page = await (await h.request(`/oauth/authorize?${params.toString()}`)).text();
    expect(page).toContain('How do I get my token?');
    expect(page).toContain('Model Context Protocol');
    expect(page).toContain(`${TEST_SITE}/admin/tool/mobile/launch.php?`);
    expect(page).toContain('confirmed=1');
  });

  it('accepts the moodlemobile:// link instead of a raw token', async () => {
    const h = setup();
    const link = `moodlemobile://token=${btoa(`7:::${MOODLE_TOKEN}:::private`)}`;
    const { code } = await obtainCode(h, link);
    expect(code).toBeTruthy();
    const [call] = h.moodle.calls;
    expect(call?.body).toMatchObject({ wstoken: MOODLE_TOKEN });
  });

  it('rejects a link that carries no token', async () => {
    const h = setup();
    const params = await authorizeParams(await register(h));
    const res = await h.request(
      '/oauth/authorize',
      form({ ...params, site: TEST_SITE, token: 'moodlemobile://moodle.example.edu?qrlogin=k&userid=1' }),
    );
    expect(res.status).toBe(400);
    expect(h.moodle.calls).toHaveLength(0);
  });

  it('never redirects to an unregistered address', async () => {
    const h = setup();
    const params = new URLSearchParams(
      await authorizeParams(await register(h), 'https://attacker.example/cb'),
    );
    const res = await h.request(`/oauth/authorize?${params.toString()}`);
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();

    const post = await h.request(
      '/oauth/authorize',
      form({
        ...(await authorizeParams(await register(h), 'https://attacker.example/cb')),
        site: TEST_SITE,
        token: MOODLE_TOKEN,
      }),
    );
    expect(post.status).toBe(400);
    expect(post.headers.get('Location')).toBeNull();
    expect(h.moodle.calls).toHaveLength(0);
  });

  it('requires PKCE S256', async () => {
    const h = setup();
    const params = new URLSearchParams({
      ...(await authorizeParams(await register(h))),
      code_challenge_method: 'plain',
    });
    expect((await h.request(`/oauth/authorize?${params.toString()}`)).status).toBe(400);
  });

  it('re-asks when Moodle rejects the token, without issuing a code', async () => {
    const h = setup(() => ({ exception: 'x', errorcode: 'invalidtoken', message: 'Invalid token' }));
    const params = await authorizeParams(await register(h));
    const res = await h.request('/oauth/authorize', form({ ...params, site: TEST_SITE, token: 'bad' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
    expect(await res.text()).toContain('Moodle rejected this token');
  });

  it('refuses a site the policy does not allow', async () => {
    const h = setup();
    const params = await authorizeParams(await register(h));
    const res = await h.request(
      '/oauth/authorize',
      form({ ...params, site: 'https://evil.example.org', token: MOODLE_TOKEN }),
    );
    expect(res.status).toBe(400);
    expect(h.moodle.calls).toHaveLength(0);
  });
});

describe('token endpoint', () => {
  it('runs the whole flow and then serves MCP with the access token', async () => {
    const h = setup(() => ({ userid: 1, fullname: 'Ann' }));
    const { clientId, code } = await obtainCode(h);

    const { status, body } = await exchange(h, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
      client_id: clientId,
    });
    expect(status).toBe(200);
    expect(body.token_type).toBe('Bearer');
    expect(body.access_token).not.toContain(MOODLE_TOKEN);

    const res = await h.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${body.access_token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_site_info', arguments: {} },
      }),
    });
    expect(res.status).toBe(200);
    await res.text();
    const calls = h.moodle.calls.filter((c) => c.url.pathname.endsWith('server.php'));
    expect(calls.at(-1)?.body).toMatchObject({ wstoken: MOODLE_TOKEN });
    expect(calls.at(-1)?.url.href.startsWith(TEST_SITE)).toBe(true);
  });

  it('rejects a wrong PKCE verifier, redirect or client', async () => {
    const h = setup();
    const { clientId, code } = await obtainCode(h);
    const good = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
      client_id: clientId,
    };
    for (const bad of [
      { code_verifier: 'w'.repeat(64) },
      { redirect_uri: 'https://attacker.example/cb' },
      { client_id: 'other' },
    ]) {
      const { status, body } = await exchange(h, { ...good, ...bad });
      expect(status).toBe(400);
      expect(body.error).toBe('invalid_grant');
    }
    expect((await exchange(h, good)).status).toBe(200);
  });

  it('rejects an expired code', async () => {
    vi.useFakeTimers();
    try {
      const h = setup();
      const { clientId, code } = await obtainCode(h);
      vi.advanceTimersByTime(61_000);
      const { status } = await exchange(h, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
        client_id: clientId,
      });
      expect(status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes, and an access token is not accepted as a refresh token', async () => {
    const h = setup();
    const { clientId, code } = await obtainCode(h);
    const first = await exchange(h, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
      client_id: clientId,
    });

    const refreshed = await exchange(h, {
      grant_type: 'refresh_token',
      refresh_token: first.body.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).toBeTruthy();

    const swapped = await exchange(h, {
      grant_type: 'refresh_token',
      refresh_token: first.body.access_token,
    });
    expect(swapped.status).toBe(400);
  });

  it('rejects an unknown grant type', async () => {
    const { status, body } = await exchange(setup(), { grant_type: 'password' });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_request');
  });
});

describe('access tokens on /mcp', () => {
  it('rejects a tampered or expired token with invalid_token', async () => {
    const h = setup();
    const res = await h.request('/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer mm1.AAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
  });

  it('never logs tokens, codes or the secret', async () => {
    const h = setup();
    const { clientId, code } = await obtainCode(h);
    const { body } = await exchange(h, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
      client_id: clientId,
    });
    const all = h.logs.join('\n');
    for (const secret of [MOODLE_TOKEN, code, body.access_token, body.refresh_token, SECRET, VERIFIER])
      expect(all).not.toContain(secret);
  });
});

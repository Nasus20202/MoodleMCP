import { describe, expect, it } from 'vitest';

import { McpClient, rpc } from './mcp.ts';
import { ALICE, BOB, OTHER_SITE_URL, OTHER_SITE_USER, SITE_URL } from './mock/data.ts';
import { useWorld } from './world.ts';

describe('header authentication, default site only', () => {
  const world = useWorld({ ALLOWED_MOODLE_HOSTS: '' });
  const siteInfo = (headers: Record<string, string>) =>
    rpc(world.worker, headers, 'tools/call', { name: 'get_site_info', arguments: {} });
  const userOf = (reply: Awaited<ReturnType<typeof siteInfo>>) =>
    JSON.parse((reply.body.result as { content: { text: string }[] }).content[0]?.text ?? '{}') as {
      userid: number;
    };

  describe('the credential', () => {
    it('accepts Authorization: Bearer', async () => {
      const reply = await siteInfo({ Authorization: `Bearer ${ALICE.token}` });
      expect(reply.status).toBe(200);
      expect(userOf(reply).userid).toBe(ALICE.id);
    });

    it('accepts the scheme in any case', async () => {
      const reply = await siteInfo({ Authorization: `bEaReR ${ALICE.token}` });
      expect(userOf(reply).userid).toBe(ALICE.id);
    });

    it('accepts X-Moodle-Token for clients that cannot set Authorization', async () => {
      const reply = await siteInfo({ 'X-Moodle-Token': BOB.token });
      expect(reply.status).toBe(200);
      expect(userOf(reply).userid).toBe(BOB.id);
    });

    it('prefers Authorization over X-Moodle-Token', async () => {
      const reply = await siteInfo({ Authorization: `Bearer ${ALICE.token}`, 'X-Moodle-Token': BOB.token });
      expect(userOf(reply).userid).toBe(ALICE.id);
    });

    it('trims whitespace around the token', async () => {
      const reply = await siteInfo({ 'X-Moodle-Token': `  ${ALICE.token}  ` });
      expect(userOf(reply).userid).toBe(ALICE.id);
    });

    it('sends the token to Moodle as given, and nothing else from the caller', async () => {
      await siteInfo({
        Authorization: `Bearer ${ALICE.token}`,
        Cookie: 'MoodleSession=abc',
        'X-Forwarded-For': '1.2.3.4',
      });
      const [call] = world.moodle.requests;
      expect(call?.token).toBe(ALICE.token);
      expect(JSON.stringify(call)).not.toMatch(/MoodleSession|1\.2\.3\.4/);
    });
  });

  describe('a missing or unusable credential', () => {
    it.each([
      ['no credentials', {}],
      ['an empty Authorization header', { Authorization: '' }],
      ['a Basic Authorization header', { Authorization: 'Basic dXNlcjpwYXNz' }],
      ['"Bearer" without a token', { Authorization: 'Bearer ' }],
      ['an empty X-Moodle-Token', { 'X-Moodle-Token': '   ' }],
    ])('answers 401 with a Bearer challenge for %s, without contacting Moodle', async (_name, headers) => {
      const reply = await siteInfo(headers);
      expect(reply.status).toBe(401);
      expect(reply.headers.get('WWW-Authenticate')).toMatch(/^Bearer realm="moodle-mcp"/);
      expect(reply.body.error).toMatch(/Missing Moodle token/);
      expect(world.moodle.requests).toHaveLength(0);
    });

    it('does not advertise OAuth when it is not configured', async () => {
      const reply = await siteInfo({});
      expect(reply.headers.get('WWW-Authenticate')).not.toContain('resource_metadata');
    });

    it('lets Moodle judge a token that looks well-formed but is wrong', async () => {
      const reply = await siteInfo({ Authorization: 'Bearer definitely-wrong' });
      expect(reply.status).toBe(200);
      const result = reply.body.result as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('invalidtoken');
    });

    it('treats a token that merely looks like a sealed OAuth token as a Moodle token when OAuth is off', async () => {
      const reply = await siteInfo({ Authorization: 'Bearer mm1.AAAA.BBBB' });
      expect(reply.status).toBe(200);
      expect(world.moodle.requests[0]?.token).toBe('mm1.AAAA.BBBB');
    });
  });

  describe('choosing the Moodle site', () => {
    const withSite = (site: string) =>
      siteInfo({ Authorization: `Bearer ${ALICE.token}`, 'X-Moodle-URL': site });

    it('uses the configured default site when no header is sent', async () => {
      await siteInfo({ Authorization: `Bearer ${ALICE.token}` });
      expect(world.moodle.requests).toHaveLength(1);
      expect(world.other.requests).toHaveLength(0);
    });

    it('accepts the default site named explicitly, in any spelling', async () => {
      for (const spelling of [SITE_URL, `${SITE_URL}/`, 'HTTPS://MOODLE.EXAMPLE.EDU/2025']) {
        expect((await withSite(spelling)).status, spelling).toBe(200);
      }
      expect(world.moodle.requests).toHaveLength(3);
    });

    it.each([
      ['another institution', OTHER_SITE_URL, 'not allowed'],
      [
        'a host that only starts like the default',
        'https://moodle.example.edu.evil.example/2025',
        'not allowed',
      ],
      ['plain http', 'http://moodle.example.edu/2025', 'must use https'],
      ['a non-web scheme', 'file:///etc/passwd', 'must use https'],
      ['credentials in the URL', 'https://user:pass@moodle.example.edu/2025', 'credentials'],
      ['a query string', 'https://moodle.example.edu/2025?x=1', 'query'],
      ['a fragment', 'https://moodle.example.edu/2025#x', 'fragment'],
      ['not a URL', 'moodle please', 'Invalid Moodle URL'],
    ])('refuses %s with 400 and contacts nothing', async (_name, site, reason) => {
      const reply = await withSite(site);
      expect(reply.status).toBe(400);
      expect(reply.body.error).toContain(reason);
      expect(world.network.sites.flatMap((s) => s.requests)).toHaveLength(0);
      expect(world.network.stray).toEqual([]);
    });
  });
});

describe('header authentication, any public Moodle site allowed', () => {
  const world = useWorld({ ALLOWED_MOODLE_HOSTS: '*' });
  const call = (headers: Record<string, string>) =>
    rpc(world.worker, headers, 'tools/call', { name: 'get_site_info', arguments: {} });

  it('talks to the site named in X-Moodle-URL, with that site’s own accounts', async () => {
    const reply = await call({
      Authorization: `Bearer ${OTHER_SITE_USER.token}`,
      'X-Moodle-URL': OTHER_SITE_URL,
    });
    const result = reply.body.result as { content: { text: string }[] };
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
      userid: OTHER_SITE_USER.id,
      username: 'carol',
    });
    expect(world.other.restCalls).toHaveLength(1);
    expect(world.moodle.requests).toHaveLength(0);
  });

  it('does not let a token of one site work on another', async () => {
    const reply = await call({ Authorization: `Bearer ${ALICE.token}`, 'X-Moodle-URL': OTHER_SITE_URL });
    const result = reply.body.result as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('invalidtoken');
  });

  it('uses the site for every call of a request, including file downloads', async () => {
    const client = new McpClient(world.worker, {
      Authorization: `Bearer ${OTHER_SITE_USER.token}`,
      'X-Moodle-URL': OTHER_SITE_URL,
    });
    const courses = await client.call('list_courses');
    expect(courses.isError).toBeUndefined();
    expect(world.other.restCalls.map((r) => r.fn)).toEqual([
      'core_webservice_get_site_info',
      'core_enrol_get_users_courses',
    ]);
    expect(world.moodle.requests).toHaveLength(0);
  });

  it('still refuses private and non-public hosts, so the Worker cannot be aimed at internal services', async () => {
    for (const site of [
      'https://localhost/moodle',
      'https://127.0.0.1/moodle',
      'https://10.0.0.5/moodle',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/moodle',
      'https://intranet/moodle',
      'https://printer.local/moodle',
      'https://db.internal/moodle',
      'https://api.localhost/moodle',
    ]) {
      const reply = await call({ Authorization: 'Bearer t', 'X-Moodle-URL': site });
      expect(reply.status, site).toBe(400);
      expect(reply.body.error, site).toMatch(/public hostname/);
    }
    expect(world.network.stray).toEqual([]);
  });
});

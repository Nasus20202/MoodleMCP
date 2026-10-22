import { describe, expect, it } from 'vitest';

import { CLIENT_IP_HEADER, clientInfoFrom, mcpClientFrom, tokenFingerprint } from './client-info.ts';

describe('tokenFingerprint', () => {
  it('is a stable 12-character hex string', async () => {
    const a = await tokenFingerprint('0123456789abcdef0123456789abcdef');
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(await tokenFingerprint('0123456789abcdef0123456789abcdef')).toBe(a);
  });

  it('differs between tokens and does not contain the token', async () => {
    const token = 'abcdef0123456789abcdef0123456789';
    const a = await tokenFingerprint(token);
    expect(a).not.toBe(await tokenFingerprint(`${token}0`));
    expect(token).not.toContain(a);
  });

  it('matches the known SHA-256 prefix', async () => {
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(await tokenFingerprint('abc')).toBe('ba7816bf8f01');
  });
});

describe('clientInfoFrom', () => {
  it('reads the Cloudflare client IP and fingerprints the bearer token', async () => {
    const info = await clientInfoFrom(
      new Headers({ [CLIENT_IP_HEADER]: ' 203.0.113.7 ', Authorization: 'Bearer abc' }),
    );
    expect(info).toEqual({ ip: '203.0.113.7', tokenId: 'ba7816bf8f01' });
  });

  it('fingerprints X-Moodle-Token too', async () => {
    expect(await clientInfoFrom(new Headers({ 'X-Moodle-Token': 'abc' }))).toEqual({
      tokenId: 'ba7816bf8f01',
    });
  });

  it('ignores X-Forwarded-For, which callers can forge', async () => {
    expect(await clientInfoFrom(new Headers({ 'X-Forwarded-For': '1.2.3.4' }))).toEqual({});
  });

  it('omits what is not there', async () => {
    expect(await clientInfoFrom(new Headers())).toEqual({});
  });
});

describe('clientInfoFrom user agent', () => {
  it('records the User-Agent, stripped of control characters and truncated', async () => {
    expect((await clientInfoFrom(new Headers({ 'User-Agent': 'claude-code/2.0\tx' }))).userAgent).toBe(
      'claude-code/2.0 x',
    );
    const long = (await clientInfoFrom(new Headers({ 'User-Agent': 'a'.repeat(500) }))).userAgent;
    expect(long).toHaveLength(200);
  });
});

describe('mcpClientFrom', () => {
  const initialize = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { clientInfo: { name: 'claude-code', version: '2.0.1' } },
  };

  it('reads the client name and version from an initialize request', () => {
    expect(mcpClientFrom(initialize)).toEqual({ clientName: 'claude-code', clientVersion: '2.0.1' });
  });

  it('finds initialize inside a batch', () => {
    expect(mcpClientFrom([{ method: 'ping' }, initialize])).toEqual({
      clientName: 'claude-code',
      clientVersion: '2.0.1',
    });
  });

  it('ignores other methods, malformed bodies and non-string labels', () => {
    expect(mcpClientFrom({ method: 'tools/call', params: { clientInfo: { name: 'x' } } })).toBeUndefined();
    expect(mcpClientFrom(null)).toBeUndefined();
    expect(mcpClientFrom('initialize')).toBeUndefined();
    expect(mcpClientFrom({ method: 'initialize', params: { clientInfo: { name: 1 } } })).toEqual({});
  });
});

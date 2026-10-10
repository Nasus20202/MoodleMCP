import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeQR, fetchTools } from './api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchTools', () => {
  it('returns the tools array', async () => {
    mockFetch(200, { tools: [{ name: 'a', description: 'd', readOnly: true, inputSchema: {} }] });
    expect(await fetchTools()).toHaveLength(1);
  });

  it('surfaces backend errors', async () => {
    mockFetch(500, { error: 'tool catalog unavailable' });
    await expect(fetchTools()).rejects.toThrow('tool catalog unavailable');
  });

  it('falls back to the status when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 502 })));
    await expect(fetchTools()).rejects.toThrow('502');
  });
});

describe('exchangeQR', () => {
  it('posts the QR text and returns the token', async () => {
    const fetchMock = mockFetch(200, { token: 'abc' });
    expect(await exchangeQR('moodlemobile://x?qrlogin=k&userid=1')).toBe('abc');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/exchange');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ qr: 'moodlemobile://x?qrlogin=k&userid=1' });
  });

  it('throws the backend message on failure', async () => {
    mockFetch(502, { error: 'moodle: qrcodedisabled: off' });
    await expect(exchangeQR('x')).rejects.toThrow('qrcodedisabled');
  });
});

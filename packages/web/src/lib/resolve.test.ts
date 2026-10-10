import { describe, expect, it, vi } from 'vitest';

import { resolveToken } from './resolve';

describe('resolveToken', () => {
  it('decodes a token link locally without calling the backend', async () => {
    const exchange = vi.fn();
    const text = `moodlemobile://token=${btoa('site:::tok')}`;
    expect(await resolveToken(text, exchange)).toEqual({ status: 'token', token: 'tok' });
    expect(exchange).not.toHaveBeenCalled();
  });

  it('exchanges a QR login link via the backend', async () => {
    const exchange = vi.fn().mockResolvedValue('fresh');
    const text = 'moodlemobile://https://x.example/2025?qrlogin=k&userid=1';
    expect(await resolveToken(text, exchange)).toEqual({ status: 'token', token: 'fresh' });
    expect(exchange).toHaveBeenCalledWith(text);
  });

  it('asks for browser login when the QR has no key', async () => {
    expect(await resolveToken('moodlemobile://https://x.example/2025', vi.fn())).toEqual({
      status: 'needs-browser-login',
    });
  });

  it('rejects unrelated text', async () => {
    await expect(resolveToken('hello', vi.fn())).rejects.toThrow(/not a Moodle/);
  });

  it('propagates backend errors', async () => {
    const exchange = vi.fn().mockRejectedValue(new Error('qrcodedisabled'));
    await expect(resolveToken('x://h?qrlogin=k&userid=1', exchange)).rejects.toThrow('qrcodedisabled');
  });
});

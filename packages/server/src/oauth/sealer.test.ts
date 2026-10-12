import { afterEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';

import { pkceChallenge, timingSafeEqualText } from './encoding.ts';
import { Sealer } from './sealer.ts';

const SECRET = 'a-secret-that-is-at-least-32-characters-long';
const schema = z.object({ token: z.string() });

afterEach(() => vi.useRealTimers());

describe('Sealer', () => {
  it('round-trips a payload without exposing it', async () => {
    const sealer = new Sealer(SECRET);
    const sealed = await sealer.seal('access', { token: 'moodle-secret' });
    expect(sealed).not.toContain('moodle-secret');
    expect(Sealer.isSealed(sealed)).toBe(true);
    expect(await sealer.open('access', sealed, schema)).toEqual({ token: 'moodle-secret' });
  });

  it('uses a fresh nonce each time', async () => {
    const sealer = new Sealer(SECRET);
    expect(await sealer.seal('access', { token: 'x' })).not.toBe(await sealer.seal('access', { token: 'x' }));
  });

  it('rejects another kind, another secret, tampering and garbage', async () => {
    const sealer = new Sealer(SECRET);
    const sealed = await sealer.seal('access', { token: 'x' });
    expect(await sealer.open('refresh', sealed, schema)).toBeUndefined();
    expect(await new Sealer(`${SECRET}!`).open('access', sealed, schema)).toBeUndefined();
    expect(await sealer.open('access', `${sealed.slice(0, -2)}AA`, schema)).toBeUndefined();
    expect(await sealer.open('access', 'mm1.!!!', schema)).toBeUndefined();
    expect(await sealer.open('access', 'plain-moodle-token', schema)).toBeUndefined();
  });

  it('rejects a payload that does not match the schema', async () => {
    const sealer = new Sealer(SECRET);
    expect(await sealer.open('access', await sealer.seal('access', { other: 1 }), schema)).toBeUndefined();
  });

  it('expires', async () => {
    vi.useFakeTimers();
    const sealer = new Sealer(SECRET);
    const sealed = await sealer.seal('code', { token: 'x' }, 60);
    vi.advanceTimersByTime(59_000);
    expect(await sealer.open('code', sealed, schema)).toBeDefined();
    vi.advanceTimersByTime(2_000);
    expect(await sealer.open('code', sealed, schema)).toBeUndefined();
  });
});

describe('pkceChallenge', () => {
  it('matches the RFC 7636 example', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('timingSafeEqualText', () => {
  it('is true only for identical strings', async () => {
    expect(await timingSafeEqualText('abc', 'abc')).toBe(true);
    expect(await timingSafeEqualText('abc', 'abd')).toBe(false);
    expect(await timingSafeEqualText('abc', 'abcd')).toBe(false);
    expect(await timingSafeEqualText('', '')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { classify, decodeLaunchToken, launchUrl } from './token';
import { QRKind } from './types/token';

const link = (payload: string) => `moodlemobile://token=${btoa(payload)}`;

describe('decodeLaunchToken', () => {
  it('extracts the token from the payload', () => {
    expect(decodeLaunchToken(link('site:::thetoken:::private'))).toBe('thetoken');
    expect(decodeLaunchToken(link('site:::thetoken'))).toBe('thetoken');
  });

  it('accepts percent-encoded base64', () => {
    const enc = encodeURIComponent(btoa('site:::tok??>>:::p'));
    expect(decodeLaunchToken(`moodlemobile://token=${enc}`)).toBe('tok??>>');
  });

  it.each([
    ['no token param', 'moodlemobile://nothing'],
    ['invalid base64', 'moodlemobile://token=!!!'],
    ['no separator', link('nosep')],
    ['empty token', link('site:::')]
  ])('rejects %s', (_name, input) => {
    expect(() => decodeLaunchToken(input)).toThrow();
  });
});

describe('classify', () => {
  it.each([
    ['moodlemobile://token=abc', QRKind.Token],
    ['moodlemobile://https://x.example/2025?qrlogin=k&userid=1', QRKind.QRLogin],
    ['https://x.example/2025?foo=1&qrlogin=k', QRKind.QRLogin],
    ['moodlemobile://https://x.example/2025', QRKind.SiteOnly],
    ['https://x.example', QRKind.SiteOnly],
    ['hello world', QRKind.Unknown],
    ['', QRKind.Unknown]
  ])('%s -> %s', (input, kind) => {
    expect(classify(input)).toBe(kind);
  });
});

describe('launchUrl', () => {
  it('builds a launch.php URL with a random passport', () => {
    const a = new URL(launchUrl('https://x.example/2025'));
    const b = new URL(launchUrl('https://x.example/2025'));
    expect(a.pathname).toBe('/2025/admin/tool/mobile/launch.php');
    expect(a.searchParams.get('service')).toBe('moodle_mobile_app');
    expect(a.searchParams.get('urlscheme')).toBe('moodlemobile');
    expect(a.searchParams.get('confirmed')).toBe('1');
    expect(a.searchParams.get('passport')).toMatch(/^[0-9a-f]{16}$/);
    expect(a.searchParams.get('passport')).not.toBe(b.searchParams.get('passport'));
  });
});

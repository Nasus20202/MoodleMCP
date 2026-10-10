import { describe, expect, it } from 'vitest';

import { classifyLink, decodeLaunchToken, launchUrl, LinkError, parseQrLogin, QRKind } from './token-link.ts';

const link = (payload: string) => `moodlemobile://token=${btoa(payload)}`;

describe('decodeLaunchToken', () => {
  it('extracts the token from the payload', () => {
    expect(decodeLaunchToken(link('site:::thetoken:::private'))).toBe('thetoken');
    expect(decodeLaunchToken(link('site:::thetoken'))).toBe('thetoken');
  });

  it('accepts percent-encoded base64', () => {
    const encoded = encodeURIComponent(btoa('site:::tok??>>:::p'));
    expect(decodeLaunchToken(`moodlemobile://token=${encoded}`)).toBe('tok??>>');
  });

  it.each([
    ['no token param', 'moodlemobile://nothing'],
    ['invalid base64', 'moodlemobile://token=!!!'],
    ['no separator', link('nosep')],
    ['empty token', link('site:::')],
  ])('rejects %s with a LinkError', (_name, input) => {
    expect(() => decodeLaunchToken(input)).toThrow(LinkError);
  });
});

describe('classifyLink', () => {
  it.each([
    ['moodlemobile://token=abc', QRKind.Token],
    ['moodlemobile://https://x.example/2025?qrlogin=k&userid=1', QRKind.QRLogin],
    ['https://x.example/2025?foo=1&qrlogin=k', QRKind.QRLogin],
    ['moodlemobile://https://x.example/2025', QRKind.SiteOnly],
    ['https://x.example', QRKind.SiteOnly],
    ['hello world', QRKind.Unknown],
    ['', QRKind.Unknown],
  ])('%s -> %s', (input, kind) => {
    expect(classifyLink(input)).toBe(kind);
  });
});

describe('parseQrLogin', () => {
  it('parses site, key and user id', () => {
    expect(parseQrLogin('moodlemobile://https://x.example/2025/?qrlogin=AbC_1&userid=7')).toEqual({
      site: 'https://x.example/2025',
      key: 'AbC_1',
      userId: 7,
    });
  });

  it('supports a custom URL scheme', () => {
    expect(parseQrLogin('myapp://https://x.example?qrlogin=k&userid=3').site).toBe('https://x.example');
  });

  it.each([
    [''],
    ['moodlemobile://https://x.example'],
    ['moodlemobile://https://x.example?qrlogin=a'],
    ['moodlemobile://https://x.example?qrlogin=a&userid=0'],
    ['moodlemobile://https://x.example?qrlogin=a&userid=abc'],
    ['::'],
  ])('rejects %j', (input) => {
    expect(() => parseQrLogin(input)).toThrow(LinkError);
  });
});

describe('launchUrl', () => {
  it('builds a launch.php URL with a random passport', () => {
    const a = new URL(launchUrl('https://x.example/2025/'));
    const b = new URL(launchUrl('https://x.example/2025'));
    expect(a.pathname).toBe('/2025/admin/tool/mobile/launch.php');
    expect(a.searchParams.get('service')).toBe('moodle_mobile_app');
    expect(a.searchParams.get('urlscheme')).toBe('moodlemobile');
    expect(a.searchParams.get('confirmed')).toBe('1');
    expect(a.searchParams.get('passport')).toMatch(/^[0-9a-f]{16}$/);
    expect(a.searchParams.get('passport')).not.toBe(b.searchParams.get('passport'));
  });

  it('accepts an explicit passport', () => {
    expect(new URL(launchUrl('https://x.example', 'abc')).searchParams.get('passport')).toBe('abc');
  });
});

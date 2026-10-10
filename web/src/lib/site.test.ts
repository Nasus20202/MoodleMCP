import { describe, expect, it } from 'vitest';
import { needsSiteHeader, normalizeSite, profileUrl, siteLabel } from './site';

describe('site helpers', () => {
  it('normalizes trailing slashes and whitespace', () => {
    expect(normalizeSite(' https://x.example/2025// ')).toBe('https://x.example/2025');
  });

  it('builds the profile URL', () => {
    expect(profileUrl('https://x.example/2025/')).toBe('https://x.example/2025/user/profile.php');
  });

  it('labels a site by hostname, tolerating partial input', () => {
    expect(siteLabel('https://x.example/2025')).toBe('x.example');
    expect(siteLabel('htt')).toBe('htt');
  });

  it.each([
    ['https://x.example/2025', 'https://x.example/2025/', false],
    ['https://x.example/moodle', 'https://x.example/2025', true],
    ['', 'https://x.example/2025', false]
  ])('needsSiteHeader(%s, %s) = %s', (site, def, want) => {
    expect(needsSiteHeader(site, def)).toBe(want);
  });
});

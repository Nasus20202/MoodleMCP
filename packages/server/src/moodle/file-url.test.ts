import { describe, expect, it } from 'vitest';

import { TEST_SITE } from '../test-utils.ts';
import { resolveFileUrl } from './file-url.ts';

const FILE = `${TEST_SITE}/webservice/pluginfile.php/12/mod_resource/content/1/a%20b.pdf`;

describe('resolveFileUrl', () => {
  it('adds the token to a web service file URL', () => {
    const url = resolveFileUrl(TEST_SITE, `${FILE}?forcedownload=1`, 'tok');
    expect(url.origin + url.pathname).toBe(FILE);
    expect(url.searchParams.get('token')).toBe('tok');
    expect(url.searchParams.get('forcedownload')).toBe('1');
  });

  it('rewrites a plain pluginfile.php URL to the token-authenticated endpoint', () => {
    const url = resolveFileUrl(TEST_SITE, `${TEST_SITE}/pluginfile.php/12/course/x.png`, 'tok');
    expect(url.pathname).toBe('/2025/webservice/pluginfile.php/12/course/x.png');
  });

  it('replaces a token already present in the URL', () => {
    const url = resolveFileUrl(TEST_SITE, `${FILE}?token=other`, 'tok');
    expect(url.searchParams.getAll('token')).toEqual(['tok']);
  });

  it.each([
    ['another host', 'https://evil.example.org/2025/webservice/pluginfile.php/1/a/b'],
    ['another scheme', 'http://moodle.example.edu/2025/webservice/pluginfile.php/1/a/b'],
    ['another port', 'https://moodle.example.edu:8443/2025/webservice/pluginfile.php/1/a/b'],
    ['userinfo trick', 'https://moodle.example.edu@evil.example.org/2025/webservice/pluginfile.php/1/a'],
    ['a non-file page', `${TEST_SITE}/user/profile.php?id=1`],
    ['a path outside the site', 'https://moodle.example.edu/other/webservice/pluginfile.php/1/a'],
    ['dot segments', `${TEST_SITE}/webservice/../login/index.php`],
    ['not a URL', 'slides.pdf'],
  ])('refuses %s', (_label, input) => {
    expect(() => resolveFileUrl(TEST_SITE, input, 'tok')).toThrow(/file_url/);
  });
});

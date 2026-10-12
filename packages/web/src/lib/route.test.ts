import { describe, expect, it } from 'vitest';

import { isHomePath, pageTitle } from './route';

describe('isHomePath', () => {
  it('accepts the root and index.html', () => {
    expect(isHomePath('/')).toBe(true);
    expect(isHomePath('/index.html')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isHomePath('/sitemap.xml')).toBe(false);
    expect(isHomePath('/foo/')).toBe(false);
  });
});

describe('pageTitle', () => {
  it('names the page', () => {
    expect(pageTitle('/')).toBe('Moodle MCP');
    expect(pageTitle('/nope')).toBe('Page not found · Moodle MCP');
  });
});

import { describe, expect, it } from 'vitest';

import { pageTitle, Route, routeOf } from './route';

describe('routeOf', () => {
  it('shows the setup page at the root and index.html', () => {
    expect(routeOf('/')).toBe(Route.Home);
    expect(routeOf('/index.html')).toBe(Route.Home);
  });

  it('shows the consent screen at /connect only', () => {
    expect(routeOf('/connect')).toBe(Route.Connect);
    expect(routeOf('/connect/')).toBe(Route.NotFound);
  });

  it('shows the not-found page for everything else', () => {
    expect(routeOf('/sitemap.xml')).toBe(Route.NotFound);
    expect(routeOf('/foo/')).toBe(Route.NotFound);
  });
});

describe('pageTitle', () => {
  it('names the page', () => {
    expect(pageTitle('/')).toBe('Moodle MCP');
    expect(pageTitle('/connect')).toBe('Connect · Moodle MCP');
    expect(pageTitle('/nope')).toBe('Page not found · Moodle MCP');
  });
});

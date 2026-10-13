/** The OAuth consent screen, where the Worker's /oauth/authorize sends the user. */
export const CONNECT_PATH = '/connect';

export const Route = { Home: 'home', Connect: 'connect', NotFound: 'not-found' } as const;
export type Route = (typeof Route)[keyof typeof Route];

/** Which page a path shows; the setup page lives at the root only. */
export function routeOf(pathname: string): Route {
  switch (pathname) {
    case '/':
    case '/index.html':
      return Route.Home;
    case CONNECT_PATH:
      return Route.Connect;
    default:
      return Route.NotFound;
  }
}

/** The document title for a path. */
export function pageTitle(pathname: string): string {
  switch (routeOf(pathname)) {
    case Route.Home:
      return 'Moodle MCP';
    case Route.Connect:
      return 'Connect · Moodle MCP';
    case Route.NotFound:
      return 'Page not found · Moodle MCP';
  }
}

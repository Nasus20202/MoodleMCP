/** The setup page lives at the root only. */
export function isHomePath(pathname: string): boolean {
  return pathname === '/' || pathname === '/index.html';
}

/** The OAuth consent screen, where the Worker's /oauth/authorize sends the user. */
export const CONNECT_PATH = '/connect';

export function isConnectPath(pathname: string): boolean {
  return pathname === CONNECT_PATH;
}

/** The document title for a path. */
export function pageTitle(pathname: string): string {
  if (isHomePath(pathname)) return 'Moodle MCP';
  if (isConnectPath(pathname)) return 'Connect · Moodle MCP';
  return 'Page not found · Moodle MCP';
}

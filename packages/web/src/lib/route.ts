/** The setup page lives at the root only; every other path shows the not-found page. */
export function isHomePath(pathname: string): boolean {
  return pathname === '/' || pathname === '/index.html';
}

/** The document title for a path. */
export function pageTitle(pathname: string): string {
  return isHomePath(pathname) ? 'Moodle MCP' : 'Page not found · Moodle MCP';
}

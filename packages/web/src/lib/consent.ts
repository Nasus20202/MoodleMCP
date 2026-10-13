import { launchUrl } from '@moodle-mcp/shared';

/** The parameters of an OAuth authorization request, as the client put them in the query string. */
export function requestFields(query: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(query));
}

/** The sign-in link for a site, or undefined if the site is not a usable URL. */
export function signInLink(site: string): string | undefined {
  try {
    return launchUrl(site);
  } catch {
    return undefined;
  }
}

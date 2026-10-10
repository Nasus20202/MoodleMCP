const TRAILING_SLASHES = /\/+$/;

export const normalizeSite = (site: string): string => site.trim().replace(TRAILING_SLASHES, '');

export const profileUrl = (site: string): string => `${normalizeSite(site)}/user/profile.php`;

/** Hostname for display, or the input itself if it is not a URL (yet). */
export function siteLabel(site: string): string {
  try {
    return new URL(site).hostname;
  } catch {
    return site;
  }
}

/** Whether requests need an explicit site header, i.e. the chosen site differs from the server default. */
export const needsSiteHeader = (site: string, defaultSite: string): boolean =>
  normalizeSite(site) !== '' && normalizeSite(site) !== normalizeSite(defaultSite);

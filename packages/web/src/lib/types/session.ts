// State shared by the page's steps.

export interface Session {
  /** The user's Moodle web service token; kept in memory only. */
  token: string;
  /** Moodle site the user wants to use; starts as the server's default. */
  site: string;
  /** The server's default site (MOODLE_URL), used to decide whether a site header is needed. */
  defaultSite: string;
}

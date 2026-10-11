import { fetchConfig } from './api';
import type { Session } from './types/session';

export const session: Session = $state({ token: '', site: '', defaultSite: '', oauth: false });

/** Fetch the server's default site and use it unless the user already picked one. */
export async function loadDefaultSite(): Promise<void> {
  const { moodleUrl, oauth } = await fetchConfig();
  session.oauth = oauth;
  session.defaultSite = moodleUrl;
  if (!session.site) session.site = moodleUrl;
}

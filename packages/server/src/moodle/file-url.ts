import { MoodleError } from './errors.ts';

/**
 * Turns a file URL taken from a Moodle response into the token-authenticated download URL.
 *
 * The URL is caller-supplied (it comes from the model), so it must point at this site's file
 * server and nowhere else; otherwise the token would be sent to an arbitrary host.
 */
export function resolveFileUrl(baseUrl: string, fileUrl: string, token: string): URL {
  const site = new URL(baseUrl);
  const basePath = site.pathname.replace(/\/+$/, '');

  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    throw invalid('file_url is not a valid URL. Use a fileurl value returned by another tool.');
  }
  if (url.origin !== site.origin) throw invalid('file_url must be on the same Moodle site.');

  const plain = `${basePath}/pluginfile.php/`;
  const webservice = `${basePath}/webservice/pluginfile.php/`;
  if (url.pathname.startsWith(plain)) {
    url.pathname = webservice + url.pathname.slice(plain.length);
  } else if (!url.pathname.startsWith(webservice)) {
    throw invalid('file_url must be a Moodle file URL (.../pluginfile.php/...), as returned by other tools.');
  }

  url.username = '';
  url.password = '';
  url.hash = '';
  url.searchParams.set('token', token);
  return url;
}

const invalid = (message: string) => new MoodleError('invalidfileurl', message);

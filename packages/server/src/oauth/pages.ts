import { launchUrl } from '@moodle-mcp/shared';

/** Server-rendered HTML for the one screen of the OAuth flow: where the user hands over a Moodle token. */

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/**
 * The same shell as the setup page (`packages/web/src/components/PageLayout.svelte`), styled by the setup page's own
 * stylesheet. The web build emits it at a fixed path and scans this file for Tailwind classes (`@source` in app.css),
 * so keep the markup below in step with PageLayout and use only that stylesheet's classes.
 */
export const STYLESHEET_PATH = '/assets/app.css';

const REPO_URL = 'https://github.com/Nasus20202/MoodleMCP';

const layout = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#4f46e5"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="stylesheet" href="${STYLESHEET_PATH}"><title>${escapeHtml(title)}</title></head><body>
<header class="bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 text-white"><div class="mx-auto flex max-w-7xl items-center justify-between gap-10 px-4 py-14 sm:px-6"><div><h1 class="text-4xl font-bold tracking-tight sm:text-5xl">Moodle MCP</h1><p class="mt-4 max-w-xl text-lg text-indigo-100">Let your AI agent read your courses, deadlines, grades and forums. Read-only, stateless, and your token never gets stored.</p></div><img src="/favicon.svg" alt="" class="hidden size-32 shrink-0 drop-shadow-2xl sm:block lg:size-40"></div></header>
<main class="mx-auto -mt-6 max-w-7xl space-y-6 px-4 pb-20 sm:px-6"><section class="card mx-auto max-w-2xl">${body}</section><footer class="pt-4 text-center text-xs text-slate-500"><a class="link" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">Source on GitHub</a></footer></main></body></html>`;

export interface ConsentView {
  /** The authorization request, repeated as hidden fields so the POST is self-contained. */
  fields: Record<string, string>;
  /** Where the user will be sent back to; shown so they can see who is asking. */
  redirectHost: string;
  defaultSite: string;
  error?: string;
}

/** The sign-in link for a site, or undefined if the site is not a usable URL. */
function signInLink(site: string): string | undefined {
  try {
    return launchUrl(site);
  } catch {
    return undefined;
  }
}

export function consentPage(view: ConsentView): string {
  const hidden = Object.entries(view.fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('');
  const error = view.error ? `<p class="alert alert-error" role="alert">${escapeHtml(view.error)}</p>` : '';
  return layout(
    'Moodle MCP: connect',
    `
    <h2 class="text-xl font-semibold">Connect your Moodle account</h2>
    <p class="muted mt-1"><code>${escapeHtml(view.redirectHost)}</code> wants read-only access to your Moodle through this server.</p>
    ${error}
    ${tutorial(view.defaultSite)}
    <form method="post" class="mt-5 space-y-4">
      ${hidden}
      <div class="space-y-1">
        <label class="eyebrow" for="site">Moodle site</label>
        <input class="input" id="site" name="site" type="url" required spellcheck="false" value="${escapeHtml(view.defaultSite)}">
      </div>
      <div class="space-y-1">
        <label class="eyebrow" for="token">Moodle token or app link</label>
        <input class="input" id="token" name="token" type="password" required autocomplete="off" spellcheck="false" autofocus>
      </div>
      <button class="btn btn-primary w-full py-2" type="submit">Allow access</button>
    </form>
    <p class="alert alert-note">🔒 The token is checked against Moodle, then sealed into an encrypted access token for your assistant. This server stores nothing.</p>`,
  );
}

export const errorPage = (message: string): string =>
  layout(
    'Moodle MCP: cannot connect',
    `<h2 class="text-xl font-semibold">Cannot connect</h2><p class="alert alert-error" role="alert">${escapeHtml(message)}</p>`,
  );

function tutorial(site: string): string {
  const link = signInLink(site);
  const open = link
    ? `<a class="link" href="${escapeHtml(link)}" target="_blank" rel="noopener">Open the Moodle sign-in page</a> and sign in with your university account.`
    : "Open your Moodle site's mobile sign-in page and sign in.";
  return `<h3 class="eyebrow mt-5">How do I get my token?</h3>
    <ol class="muted mt-2 list-decimal space-y-2 pl-5">
      <li>${open}</li>
      <li>Moodle shows a <strong>“Click here to launch the app”</strong> link. Nothing will open; that is expected.</li>
      <li>Right-click that link, choose <strong>Copy link address</strong>, and paste it below. It starts with <code>moodlemobile://token=</code>; we extract the token for you.</li>
    </ol>
    <p class="muted mt-3 text-sm">Using the Moodle app's QR code instead? Use the <a class="link" href="/" target="_blank" rel="noopener">setup page</a> to turn it into a token.</p>`;
}

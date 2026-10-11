import { launchUrl } from '@moodle-mcp/shared';

/** Server-rendered HTML for the one screen of the OAuth flow: where the user hands over a Moodle token. */

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** Mirrors the setup page (packages/web/src/app.css): same palette, card, hero and buttons, plus dark mode. */
const STYLE = `
  :root {
    color-scheme: light dark;
    --bg: #f8fafc; --text: #1e293b; --muted: #475569; --eyebrow: #64748b;
    --card: #fff; --border: #e2e8f0; --input-border: #cbd5e1; --input-bg: #fff; --code-bg: #f1f5f9;
    --link: #4f46e5; --error-bg: #fef2f2; --error-text: #b91c1c;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #020617; --text: #e2e8f0; --muted: #94a3b8; --eyebrow: #64748b;
      --card: #0f172a; --border: #1e293b; --input-border: #334155; --input-bg: #020617; --code-bg: #1e293b;
      --link: #818cf8; --error-bg: #450a0a66; --error-text: #fca5a5;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; line-height: 1.5; }
  header { background: linear-gradient(135deg, #4f46e5, #4338ca 50%, #5b21b6); color: #fff; }
  header div { max-width: 40rem; margin: 0 auto; padding: 2.5rem 1rem 3.5rem; }
  header p { margin: 0 0 .25rem; font-size: .8rem; font-weight: 500; letter-spacing: .1em; text-transform: uppercase; color: #c7d2fe; }
  header h1 { margin: 0; font-size: 2rem; font-weight: 700; letter-spacing: -.02em; }
  main { max-width: 40rem; margin: -1.5rem auto 0; padding: 0 1rem 3rem; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; padding: 1.5rem; box-shadow: 0 1px 2px #0000000d; }
  h2 { margin: 0 0 .5rem; font-size: 1.25rem; font-weight: 600; letter-spacing: -.01em; }
  p { margin: 0 0 1rem; color: var(--muted); }
  a { color: var(--link); font-weight: 500; text-underline-offset: 2px; }
  code { background: var(--code-bg); border-radius: .25rem; padding: .1rem .35rem; font-family: ui-monospace, monospace; font-size: .85em; word-break: break-all; }
  .eyebrow { display: block; margin: 1rem 0 .25rem; font-size: .75rem; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--eyebrow); }
  input[type=url], input[type=password] { width: 100%; padding: .5rem .75rem; font: .875rem ui-monospace, monospace; color: inherit; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: .5rem; box-shadow: 0 1px 2px #0000000d; outline: none; }
  input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px #6366f14d; }
  button { margin-top: 1.25rem; width: 100%; padding: .6rem 1rem; font: inherit; font-size: .875rem; font-weight: 500; color: #fff; background: #4f46e5; border: 0; border-radius: .5rem; box-shadow: 0 1px 2px #0000000d; cursor: pointer; transition: background .15s, transform .1s; }
  button:hover { background: #6366f1; }
  button:active { transform: scale(.98); }
  .alert { margin: 0 0 1rem; padding: .5rem .75rem; font-size: .875rem; border-radius: .5rem; background: var(--error-bg); color: var(--error-text); }
  .steps { margin: 0 0 1.25rem; padding: 0; list-style: none; counter-reset: step; }
  .steps li { position: relative; margin: 0 0 .75rem; padding-left: 2.25rem; color: var(--muted); counter-increment: step; }
  .steps li::before { content: counter(step); position: absolute; left: 0; top: 0; display: flex; width: 1.5rem; height: 1.5rem; align-items: center; justify-content: center; border-radius: 9999px; background: #4f46e5; color: #fff; font-size: .75rem; font-weight: 700; }
  .note { margin: 1rem 0 0; padding: .5rem .75rem; font-size: .8rem; border-radius: .5rem; background: var(--code-bg); color: var(--muted); }
`;

const layout = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#4f46e5"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><title>Moodle MCP: connect</title><style>${STYLE}</style></head><body><header><div><p>Model Context Protocol</p><h1>Moodle MCP</h1></div></header><main><section class="card">${body}</section></main></body></html>`;

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
  const error = view.error ? `<p class="alert" role="alert">${escapeHtml(view.error)}</p>` : '';
  return layout(`
    <h2>Connect your Moodle account</h2>
    <p><code>${escapeHtml(view.redirectHost)}</code> wants read-only access to your Moodle through this server.</p>
    ${error}
    ${tutorial(view.defaultSite)}
    <form method="post">
      ${hidden}
      <label class="eyebrow" for="site">Moodle site</label>
      <input id="site" name="site" type="url" required spellcheck="false" value="${escapeHtml(view.defaultSite)}">
      <label class="eyebrow" for="token">Moodle token or app link</label>
      <input id="token" name="token" type="password" required autocomplete="off" spellcheck="false" autofocus>
      <button type="submit">Allow access</button>
    </form>
    <p class="note">🔒 The token is checked against Moodle, then sealed into an encrypted access token for your assistant. This server stores nothing.</p>`);
}

export const errorPage = (message: string): string =>
  layout(`<h2>Cannot connect</h2><p class="alert" role="alert">${escapeHtml(message)}</p>`);

function tutorial(site: string): string {
  const link = signInLink(site);
  const open = link
    ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">Open the Moodle sign-in page</a> and sign in with your university account.`
    : "Open your Moodle site's mobile sign-in page and sign in.";
  return `<span class="eyebrow">How do I get my token?</span>
    <ol class="steps">
      <li>${open}</li>
      <li>Moodle shows a <strong>“Click here to launch the app”</strong> link. Nothing will open; that is expected.</li>
      <li>Right-click that link, choose <strong>Copy link address</strong>, and paste it below. It starts with <code>moodlemobile://token=</code>; we extract the token for you.</li>
    </ol>
    <p>Using the Moodle app's QR code instead? Use the <a href="/" target="_blank" rel="noopener">setup page</a> to turn it into a token.</p>`;
}

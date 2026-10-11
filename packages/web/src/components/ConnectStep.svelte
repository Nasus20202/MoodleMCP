<script lang="ts">
  import { needsSiteHeader, normalizeSite, SITE_HEADER } from '@moodle-mcp/shared';

  import { MASK, mcpEndpoint, TOKEN_PLACEHOLDER } from '../lib/constants';
  import { session } from '../lib/session.svelte';
  import { type ConnectionDetails, headerExamples, oauthExamples } from '../lib/snippets';
  import CopyButton from './CopyButton.svelte';
  import ExampleList from './ExampleList.svelte';

  const endpoint = mcpEndpoint();
  let reveal = $state(false);

  const hasToken = $derived(session.token !== '');
  const site = $derived(
    needsSiteHeader(session.site, session.defaultSite) ? normalizeSite(session.site) : undefined,
  );
  const details = (token: string): ConnectionDetails => ({ token, site });

  const realToken = $derived(session.token || TOKEN_PLACEHOLDER);
  const shownToken = $derived(hasToken && !reveal ? MASK : realToken);
</script>

<p class="muted mb-4">
  Any agent or IDE that supports remote MCP servers (Streamable HTTP) will work. Add a server with the URL
  below, then authenticate in one of two ways.
</p>

<dl class="mb-5">
  <dt class="eyebrow mb-1">Server URL</dt>
  <dd class="flex items-center gap-2">
    <code class="value">{endpoint}</code>
    <CopyButton text={endpoint} />
  </dd>
</dl>

{#if session.oauth}
  <section class="mb-5">
    <h3 class="mb-1 font-semibold">Option A: sign in with OAuth</h3>
    <p class="muted">
      For clients that cannot send custom headers, such as ChatGPT or claude.ai connectors. Add the server URL
      only, with no header. When the client asks you to sign in, it opens a page on this server where you
      paste the token from step 1. Your assistant then receives an encrypted access token, valid for 12 hours
      and renewed automatically.
    </p>
    <p class="muted mt-2">
      If the client offers a choice, pick <strong>automatic (dynamic) client registration</strong>, or leave
      the OAuth client ID and secret empty. Do not enter your Moodle token there: it is only pasted on the
      sign-in page.
    </p>
    <p class="muted mt-2">On the sign-in page, enter:</p>
    <dl class="mt-2 space-y-3">
      {#if site}
        <div>
          <dt class="eyebrow mb-1">Moodle site (change it from the default)</dt>
          <dd class="flex items-center gap-2">
            <code class="value">{site}</code>
            <CopyButton text={site} label="Copy site" />
          </dd>
        </div>
      {/if}
      <div>
        <dt class="eyebrow mb-1">Moodle token</dt>
        <dd class="flex items-center gap-2">
          <code class="value">{shownToken}</code>
          {#if hasToken}
            <button type="button" class="btn btn-secondary" onclick={() => (reveal = !reveal)}
              >{reveal ? 'Hide' : 'Show'}</button
            >
          {/if}
          <CopyButton text={realToken} label="Copy token" disabled={!hasToken} />
        </dd>
      </div>
    </dl>
    <details class="mt-3">
      <summary class="link cursor-pointer text-sm">Config examples</summary>
      <div class="mt-3"><ExampleList shown={oauthExamples()} /></div>
    </details>
  </section>
{/if}

<h3 class="mb-2 font-semibold">{session.oauth ? 'Option B: send a header' : 'Send a header'}</h3>
<p class="muted mb-3">Send the header{site ? 's' : ''} below with every request.</p>

<dl class="space-y-3">
  <div>
    <dt class="eyebrow mb-1">Authorization header</dt>
    <dd class="flex items-center gap-2">
      <code class="value">Authorization: Bearer {shownToken}</code>
      {#if hasToken}
        <button type="button" class="btn btn-secondary" onclick={() => (reveal = !reveal)}
          >{reveal ? 'Hide' : 'Show'}</button
        >
      {/if}
      <CopyButton text={`Bearer ${realToken}`} label="Copy value" disabled={!hasToken} />
    </dd>
  </div>
  {#if site}
    <div>
      <dt class="eyebrow mb-1">Moodle site header</dt>
      <dd class="flex items-center gap-2">
        <code class="value">{SITE_HEADER}: {site}</code>
        <CopyButton text={site} label="Copy value" />
      </dd>
    </div>
  {/if}
</dl>

<details class="mt-5">
  <summary class="link cursor-pointer text-sm">Config examples</summary>
  <div class="mt-3">
    <ExampleList
      shown={headerExamples(details(shownToken))}
      copy={headerExamples(details(realToken))}
      copyDisabled={!hasToken}
    />
  </div>
</details>

<p class="alert alert-note mt-5">
  🔒 Treat the token like a password. To revoke it, reset the “Moodle mobile web service” key under
  <em>Preferences → Security keys</em> in Moodle.
</p>

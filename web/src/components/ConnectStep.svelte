<script lang="ts">
  import { MASK, SITE_HEADER, TOKEN_PLACEHOLDER, mcpEndpoint } from '../lib/constants';
  import { session } from '../lib/session.svelte';
  import { needsSiteHeader, normalizeSite } from '../lib/site';
  import { claudeCodeCommand, jsonConfig, type ConnectionDetails } from '../lib/snippets';
  import CopyButton from './CopyButton.svelte';

  const endpoint = mcpEndpoint();
  let reveal = $state(false);

  const hasToken = $derived(session.token !== '');
  const site = $derived(needsSiteHeader(session.site, session.defaultSite) ? normalizeSite(session.site) : undefined);
  const details = (token: string): ConnectionDetails => ({ token, site });

  const realToken = $derived(session.token || TOKEN_PLACEHOLDER);
  const shownToken = $derived(hasToken && !reveal ? MASK : realToken);
</script>

<p class="muted mb-4">
  Any agent or IDE that supports remote MCP servers (Streamable HTTP) will work. Add a server with the URL below and send the
  header{site ? 's' : ''} with every request.
</p>

<dl class="space-y-3">
  <div>
    <dt class="eyebrow mb-1">Server URL</dt>
    <dd class="flex items-center gap-2">
      <code class="value">{endpoint}</code>
      <CopyButton text={endpoint} />
    </dd>
  </div>
  <div>
    <dt class="eyebrow mb-1">Authorization header</dt>
    <dd class="flex items-center gap-2">
      <code class="value">Authorization: Bearer {shownToken}</code>
      {#if hasToken}
        <button type="button" class="btn btn-secondary" onclick={() => (reveal = !reveal)}>{reveal ? 'Hide' : 'Show'}</button>
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
  <div class="mt-3 space-y-4">
    <div>
      <p class="eyebrow mb-1">Generic MCP config (JSON)</p>
      <div class="flex items-start gap-2">
        <pre class="flex-1 overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-800">{jsonConfig(details(shownToken))}</pre>
        <CopyButton text={jsonConfig(details(realToken))} disabled={!hasToken} />
      </div>
    </div>
    <div>
      <p class="eyebrow mb-1">Example: Claude Code</p>
      <div class="flex items-start gap-2">
        <pre class="flex-1 overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-800">{claudeCodeCommand(details(shownToken))}</pre>
        <CopyButton text={claudeCodeCommand(details(realToken))} disabled={!hasToken} />
      </div>
    </div>
  </div>
</details>

<p class="alert alert-note mt-5">
  🔒 Treat the token like a password. To revoke it, reset the “Moodle mobile web service” key under
  <em>Preferences → Security keys</em> in Moodle.
</p>

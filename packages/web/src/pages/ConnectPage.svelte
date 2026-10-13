<script lang="ts">
  import type { AuthorizeContextResponse } from '@moodle-mcp/shared';
  import { onMount } from 'svelte';

  import PageLayout from '../components/PageLayout.svelte';
  import { fetchAuthorizeContext, submitConsent } from '../lib/api';
  import { requestFields, signInLink } from '../lib/consent';
  import { onLinkClick } from '../lib/router.svelte';

  const query = window.location.search;

  let context = $state<AuthorizeContextResponse>();
  let loadError = $state('');
  let site = $state('');
  let token = $state('');
  let error = $state('');
  let busy = $state(false);

  const link = $derived(signInLink(site));

  onMount(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.append(robots);

    fetchAuthorizeContext(query).then(
      (loaded) => {
        context = loaded;
        site = loaded.defaultSite;
      },
      (e: unknown) => {
        loadError = e instanceof Error ? e.message : 'Invalid authorization request.';
      },
    );
    return () => robots.remove();
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      window.location.assign(await submitConsent({ ...requestFields(query), site, token }));
    } catch (e) {
      error = e instanceof Error ? e.message : 'Something went wrong.';
      busy = false;
    }
  }
</script>

<PageLayout>
  <section class="card mx-auto max-w-2xl">
    {#if loadError}
      <h2 class="text-xl font-semibold tracking-tight">Cannot connect</h2>
      <p class="alert alert-error" role="alert">{loadError}</p>
      <a class="link mt-4 inline-block" href="/" onclick={onLinkClick}>Back to setup</a>
    {:else if !context}
      <div class="skeleton" aria-busy="true"></div>
    {:else}
      <h2 class="text-xl font-semibold tracking-tight">Connect your Moodle account</h2>
      <p class="muted mt-1">
        <code>{context.redirectHost}</code> wants read-only access to your Moodle through this server.
      </p>

      <h3 class="eyebrow mt-5">How do I get my token?</h3>
      <ol class="muted mt-2 list-decimal space-y-2 pl-5">
        <li>
          {#if link}
            <a class="link" href={link} target="_blank" rel="noopener">Open the Moodle sign-in page</a> and sign
            in with your university account.
          {:else}
            Open your Moodle site's mobile sign-in page and sign in.
          {/if}
        </li>
        <li>
          Moodle shows a <strong>“Click here to launch the app”</strong> link. Nothing will open; that is expected.
        </li>
        <li>
          Right-click that link, choose <strong>Copy link address</strong>, and paste it below. It starts with
          <code>moodlemobile://token=</code>; we extract the token for you.
        </li>
      </ol>
      <p class="muted mt-3 text-sm">
        Using the Moodle app's QR code instead? Use the
        <a class="link" href="/" target="_blank" rel="noopener">setup page</a> to turn it into a token.
      </p>

      {#if error}<p class="alert alert-error" role="alert">{error}</p>{/if}

      <form class="mt-5 space-y-4" onsubmit={submit}>
        <label class="block space-y-1">
          <span class="eyebrow">Moodle site</span>
          <input class="input" type="url" required spellcheck="false" bind:value={site} />
        </label>
        <label class="block space-y-1">
          <span class="eyebrow">Moodle token or app link</span>
          <input
            class="input"
            type="password"
            required
            autocomplete="off"
            spellcheck="false"
            bind:value={token}
          />
        </label>
        <button class="btn btn-primary w-full py-2" type="submit" disabled={busy}>Allow access</button>
      </form>
      <p class="alert alert-note">
        🔒 The token is checked against Moodle, then sealed into an encrypted access token for your assistant.
        This server stores nothing.
      </p>
    {/if}
  </section>
</PageLayout>

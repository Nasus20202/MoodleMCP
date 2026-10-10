<script lang="ts">
  import { resolveToken } from '../lib/resolve';
  import { session } from '../lib/session.svelte';
  import { normalizeSite, profileUrl } from '../lib/site';
  import { launchUrl } from '../lib/token';
  import QRDropzone from './QRDropzone.svelte';
  import SiteField from './SiteField.svelte';

  type Tab = 'link' | 'qr';

  let tab = $state<Tab>('link');
  let error = $state('');
  let notice = $state('');
  let link = $state('');

  const NEEDS_BROWSER_LOGIN =
    'This QR code only contains the site address, not a login key. Use the browser sign-in tab instead.';

  /** Resolve text into a token and update the UI accordingly. */
  async function applyText(text: string) {
    error = notice = '';
    const result = await resolveToken(text);
    if (result.status === 'token') {
      session.token = result.token;
    } else {
      notice = NEEDS_BROWSER_LOGIN;
      tab = 'link';
    }
  }

  async function onLinkInput() {
    if (!link.trim()) {
      error = notice = '';
      return;
    }
    try {
      await applyText(link);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const openSignIn = () => window.open(launchUrl(normalizeSite(session.site)), '_blank', 'noopener');
</script>

<SiteField />

<div class="tabs" role="tablist">
  <button role="tab" aria-selected={tab === 'link'} class="tab" class:tab-active={tab === 'link'} onclick={() => (tab = 'link')}>Browser sign-in</button>
  <button role="tab" aria-selected={tab === 'qr'} class="tab" class:tab-active={tab === 'qr'} onclick={() => (tab = 'qr')}>QR screenshot</button>
</div>

{#if tab === 'link'}
  <ol class="muted mb-3 list-decimal space-y-2 pl-5">
    <li><button class="btn btn-primary" onclick={openSignIn} disabled={!session.site}>Open Moodle sign-in ↗</button></li>
    <li>Sign in. Moodle then shows a page with a <strong>“Click here to launch the app”</strong> link.</li>
    <li>
      If your browser asks to open an app, cancel. Right-click that link, choose <strong>Copy link address</strong>, and paste it below.
    </li>
  </ol>
  <textarea rows="3" class="input" placeholder="moodlemobile://token=…" spellcheck="false" bind:value={link} oninput={onLinkInput}></textarea>
{:else}
  <p class="muted mb-3">
    Open your <a class="link" href={profileUrl(session.site)} target="_blank" rel="noreferrer">Moodle profile</a>, take a screenshot of the
    mobile-app QR code, then drop, paste (<kbd class="kbd">Ctrl</kbd>+<kbd class="kbd">V</kbd>) or pick it here.
  </p>
  <QRDropzone active={tab === 'qr'} onText={applyText} onError={(m) => (error = m)} />
  <p class="mt-2 text-xs text-slate-500">
    The image is decoded in your browser and never uploaded. If the code carries a one-time login key, only that key is sent to this
    server to obtain your token.
  </p>
{/if}

{#if notice}<p class="alert alert-warning">{notice}</p>{/if}
{#if error}<p class="alert alert-error" role="alert">{error}</p>{/if}
{#if session.token}<p class="alert alert-success">✓ Token ready, continue with the next step.</p>{/if}

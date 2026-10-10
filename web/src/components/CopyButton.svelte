<script lang="ts">
  interface Props {
    text: string;
    label?: string;
    disabled?: boolean;
  }
  let { text, label = 'Copy', disabled = false }: Props = $props();

  const FEEDBACK_MS = 1500;
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), FEEDBACK_MS);
    } catch {
      // clipboard unavailable (insecure context or denied); nothing useful to show
    }
  }
</script>

<button type="button" class="btn btn-secondary" class:btn-disabled={disabled} {disabled} onclick={copy}>
  {copied ? '✓ Copied' : label}
</button>

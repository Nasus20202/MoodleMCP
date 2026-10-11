<script lang="ts">
  import type { ConfigExample } from '../lib/snippets';
  import CopyButton from './CopyButton.svelte';

  interface Props {
    /** What is shown; may hide secrets. */
    shown: ConfigExample[];
    /** What the copy buttons put on the clipboard; same order as `shown`. Defaults to `shown`. */
    copy?: ConfigExample[];
    copyDisabled?: boolean;
  }
  let { shown, copy = shown, copyDisabled = false }: Props = $props();
</script>

<div class="space-y-4">
  {#each shown as example, i (example.title)}
    <div>
      <p class="eyebrow mb-1">{example.title}</p>
      <div class="flex items-start gap-2">
        <pre
          class="flex-1 overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-800">{example.code}</pre>
        <CopyButton text={copy[i]?.code ?? example.code} disabled={copyDisabled} />
      </div>
      {#if example.note}
        <p class="muted mt-1 text-xs">{example.note}</p>
      {/if}
    </div>
  {/each}
</div>

<script lang="ts">
  import { toolArguments } from '../lib/tools';
  import type { ToolInfo } from '../lib/types/tools';

  let { tool }: { tool: ToolInfo } = $props();
  const args = $derived(toolArguments(tool));
</script>

<article class="tool-card">
  <div class="mb-1 flex items-center justify-between gap-2">
    <h3 class="font-mono text-sm font-semibold">{tool.name}</h3>
    {#if tool.readOnly}<span class="badge">read-only</span>{/if}
  </div>
  <p class="muted text-sm">{tool.description}</p>
  {#each args as arg (arg.name)}
    <p class="mt-2 text-xs text-slate-500">
      <code>{arg.name}</code>{arg.required ? '*' : ''}
      <span class="opacity-70">({arg.type})</span>
      {#if arg.description}— {arg.description}{/if}
    </p>
  {/each}
</article>

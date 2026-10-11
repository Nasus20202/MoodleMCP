<script lang="ts">
  import type { ToolInfo } from '@moodle-mcp/shared';
  import { onMount } from 'svelte';

  import { fetchTools } from '../lib/api';
  import ToolCard from './ToolCard.svelte';

  const SKELETON_COUNT = 6;

  let tools = $state<ToolInfo[]>([]);
  let loading = $state(true);
  let error = $state('');
  let open = $state<Record<string, boolean>>({});
  const allOpen = $derived(tools.length > 0 && tools.every((t) => open[t.name]));

  const setAll = (value: boolean) => (open = Object.fromEntries(tools.map((t) => [t.name, value])));

  async function load() {
    loading = true;
    error = '';
    try {
      tools = await fetchTools();
      setAll(false);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

{#if loading}
  <div class="space-y-2">
    {#each { length: SKELETON_COUNT } as _, i (i)}<div class="skeleton"></div>{/each}
  </div>
{:else if error}
  <p class="alert alert-error" role="alert">
    Could not load tools: {error}
    <button class="ml-2 underline" onclick={load}>Retry</button>
  </p>
{:else}
  <div class="mb-2 flex items-center justify-between gap-3">
    <p class="text-xs text-slate-500">{tools.length} tools, loaded live from the server.</p>
    <button type="button" class="btn btn-secondary" onclick={() => setAll(!allOpen)}
      >{allOpen ? 'Collapse all' : 'Expand all'}</button
    >
  </div>
  <div class="tool-list">
    {#each tools as tool (tool.name)}<ToolCard {tool} bind:open={open[tool.name]} />{/each}
  </div>
{/if}

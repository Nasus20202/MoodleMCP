<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchTools } from '../lib/api';
  import type { ToolInfo } from '../lib/types/tools';
  import ToolCard from './ToolCard.svelte';

  const SKELETON_COUNT = 6;

  let tools = $state<ToolInfo[]>([]);
  let loading = $state(true);
  let error = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      tools = await fetchTools();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

{#if loading}
  <div class="grid gap-3 sm:grid-cols-2">
    {#each { length: SKELETON_COUNT } as _, i (i)}<div class="skeleton"></div>{/each}
  </div>
{:else if error}
  <p class="alert alert-error" role="alert">
    Could not load tools: {error}
    <button class="ml-2 underline" onclick={load}>Retry</button>
  </p>
{:else}
  <div class="grid gap-3 sm:grid-cols-2">
    {#each tools as tool (tool.name)}<ToolCard {tool} />{/each}
  </div>
  <p class="mt-3 text-xs text-slate-500">{tools.length} tools, loaded live from the server.</p>
{/if}

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    n: number;
    title: string;
    children: Snippet;
  }
  let { n, title, children }: Props = $props();
</script>

<section class="card">
  <div class="mb-4 flex items-center gap-3">
    <span
      class="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white"
      >{n}</span
    >
    <h2 class="text-xl font-semibold tracking-tight">{title}</h2>
  </div>
  {@render children()}
</section>

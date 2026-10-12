<script lang="ts">
  import type { Snippet } from 'svelte';

  import { REPO_URL } from '../lib/constants';
  import Logo from './Logo.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<header class="bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 text-white">
  <div class="mx-auto flex max-w-7xl items-center justify-between gap-10 px-4 py-14 sm:px-6">
    <div>
      <h1 class="text-4xl font-bold tracking-tight sm:text-5xl">Moodle MCP</h1>
      <p class="mt-4 max-w-xl text-lg text-indigo-100">
        Let your AI agent read your courses, deadlines, grades and forums. Read-only, stateless, and your
        token never gets stored.
      </p>
    </div>
    <Logo class="hidden size-32 shrink-0 drop-shadow-2xl sm:block lg:size-40" />
  </div>
</header>

<main class="mx-auto -mt-6 max-w-7xl space-y-6 px-4 pb-20 sm:px-6">
  {@render children()}
  <footer class="pt-4 text-center text-xs text-slate-500">
    <a class="link" href={REPO_URL} target="_blank" rel="noopener noreferrer">Source on GitHub</a>
  </footer>
</main>

<script lang="ts">
  import { session } from '../lib/session.svelte';
  import { siteLabel } from '../lib/site';
</script>

<header class="bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 text-white">
  <div class="mx-auto max-w-3xl px-4 py-14">
    <p class="mb-2 text-sm font-medium uppercase tracking-widest text-indigo-200">Model Context Protocol</p>
    <h1 class="text-4xl font-bold tracking-tight sm:text-5xl">Moodle MCP</h1>
    <p class="mt-4 max-w-xl text-lg text-indigo-100">
      Let your AI agent read your courses, deadlines, grades and forums{session.site ? ` on ${siteLabel(session.site)}` : ''}.
      Read-only, stateless, and your token never gets stored.
    </p>
  </div>
</header>

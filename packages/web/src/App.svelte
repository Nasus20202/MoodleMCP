<script lang="ts">
  import { onMount } from 'svelte';

  import ConnectStep from './components/ConnectStep.svelte';
  import Hero from './components/Hero.svelte';
  import Step from './components/Step.svelte';
  import TokenStep from './components/TokenStep.svelte';
  import ToolList from './components/ToolList.svelte';
  import { REPO_URL } from './lib/constants';
  import { loadDefaultSite } from './lib/session.svelte';

  onMount(() => {
    loadDefaultSite().catch(() => {
      // the site field stays empty; the user can type their Moodle URL
    });
  });
</script>

<Hero />

<main class="mx-auto -mt-6 max-w-7xl space-y-6 px-4 pb-20 sm:px-6">
  <Step n={1} title="Get your token"><TokenStep /></Step>
  <Step n={2} title="Add it to your agent"><ConnectStep /></Step>
  <Step n={3} title="What your agent can do"><ToolList /></Step>
  <footer class="pt-4 text-center text-xs text-slate-500">
    <a class="link" href={REPO_URL} target="_blank" rel="noopener noreferrer">Source on GitHub</a>
  </footer>
</main>

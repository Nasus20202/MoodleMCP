<script lang="ts">
  import { onMount } from 'svelte';
  import { loadDefaultSite } from './lib/session.svelte';
  import ConnectStep from './components/ConnectStep.svelte';
  import Hero from './components/Hero.svelte';
  import Step from './components/Step.svelte';
  import ToolList from './components/ToolList.svelte';
  import TokenStep from './components/TokenStep.svelte';

  onMount(() => {
    loadDefaultSite().catch(() => {
      // the site field stays empty; the user can type their Moodle URL
    });
  });
</script>

<Hero />

<main class="mx-auto -mt-6 max-w-3xl space-y-6 px-4 pb-20">
  <Step n={1} title="Get your token"><TokenStep /></Step>
  <Step n={2} title="Add it to your agent"><ConnectStep /></Step>
  <Step n={3} title="What your agent can do"><ToolList /></Step>
  <footer class="pt-4 text-center text-xs text-slate-500">
    Cannot modify anything in Moodle · token is sent only as a request header
  </footer>
</main>

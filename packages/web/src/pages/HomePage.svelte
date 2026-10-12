<script lang="ts">
  import { onMount } from 'svelte';

  import ConnectStep from '../components/ConnectStep.svelte';
  import PageLayout from '../components/PageLayout.svelte';
  import Step from '../components/Step.svelte';
  import TokenStep from '../components/TokenStep.svelte';
  import ToolList from '../components/ToolList.svelte';
  import { loadDefaultSite } from '../lib/session.svelte';

  onMount(() => {
    loadDefaultSite().catch(() => {
      // the site field stays empty; the user can type their Moodle URL
    });
  });
</script>

<PageLayout>
  <Step n={1} title="Get your token"><TokenStep /></Step>
  <Step n={2} title="Add it to your agent"><ConnectStep /></Step>
  <Step n={3} title="What your agent can do"><ToolList /></Step>
</PageLayout>

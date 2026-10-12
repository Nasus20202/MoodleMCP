<script lang="ts">
  import { onMount } from 'svelte';

  import PageLayout from '../components/PageLayout.svelte';
  import { onLinkClick } from '../lib/router.svelte';

  onMount(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.append(robots);
    return () => robots.remove();
  });
</script>

<PageLayout>
  <section class="card flex flex-col items-center gap-6 px-6 py-16 text-center sm:py-24">
    <p
      class="bg-gradient-to-br from-indigo-500 to-violet-700 bg-clip-text text-8xl font-extrabold tracking-tight text-transparent sm:text-9xl"
    >
      404
    </p>
    <h2 class="text-2xl font-semibold sm:text-3xl">Page not found</h2>
    <a class="btn btn-primary px-8 py-3 text-lg" href="/" onclick={onLinkClick}>Back to setup</a>
  </section>
</PageLayout>

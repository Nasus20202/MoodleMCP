<script lang="ts">
  import { pageTitle, Route, routeOf } from './lib/route';
  import { router } from './lib/router.svelte';
  import ConnectPage from './pages/ConnectPage.svelte';
  import HomePage from './pages/HomePage.svelte';
  import NotFoundPage from './pages/NotFoundPage.svelte';

  // The Worker serves this app for every unknown path, so the path alone decides the page.
  const route = $derived(routeOf(router.path));

  $effect(() => {
    document.title = pageTitle(router.path);
  });
</script>

{#if route === Route.Home}
  <HomePage />
{:else if route === Route.Connect}
  <ConnectPage />
{:else}
  <NotFoundPage />
{/if}

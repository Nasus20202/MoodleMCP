<script lang="ts">
  import { isConnectPath, isHomePath, pageTitle } from './lib/route';
  import { router } from './lib/router.svelte';
  import ConnectPage from './pages/ConnectPage.svelte';
  import HomePage from './pages/HomePage.svelte';
  import NotFoundPage from './pages/NotFoundPage.svelte';

  // The Worker serves this app for every unknown path, so the path alone decides the page.
  const Page = $derived(
    isHomePath(router.path) ? HomePage : isConnectPath(router.path) ? ConnectPage : NotFoundPage,
  );

  $effect(() => {
    document.title = pageTitle(router.path);
  });
</script>

<Page />

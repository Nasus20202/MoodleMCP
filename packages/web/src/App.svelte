<script lang="ts">
  import { isHomePath, pageTitle } from './lib/route';
  import { router } from './lib/router.svelte';
  import HomePage from './pages/HomePage.svelte';
  import NotFoundPage from './pages/NotFoundPage.svelte';

  // The Worker serves this app for every unknown path, so the path alone decides the page.
  const Page = $derived(isHomePath(router.path) ? HomePage : NotFoundPage);

  $effect(() => {
    document.title = pageTitle(router.path);
  });
</script>

<Page />

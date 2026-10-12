/** The current path, kept in sync with the address bar so pages can change without a reload. */
export const router = $state({ path: window.location.pathname });

window.addEventListener('popstate', () => {
  router.path = window.location.pathname;
});

/** Moves to `path` like a link would, but without reloading the page. */
export function navigate(path: string): void {
  if (path === router.path) return;
  history.pushState(null, '', path);
  router.path = path;
  window.scrollTo(0, 0);
}

/** A click handler for same-site links: plain left clicks navigate in place, others keep the browser default. */
export function onLinkClick(event: MouseEvent & { currentTarget: HTMLAnchorElement }): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(event.currentTarget.pathname);
}

<script lang="ts">
  let { class: className = '' }: { class?: string } = $props();
</script>

<!-- Same mark as public/favicon.svg. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" class={className} aria-hidden="true">
  <defs>
    <linearGradient id="logo-gradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#818cf8" />
      <stop offset="1" stop-color="#6d28d9" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#logo-gradient)" />
  <path d="M32 17 10 27l22 10 22-10z" fill="#fff" />
  <path d="M19 34v9c0 3 6 7 13 7s13-4 13-7v-9l-13 6z" fill="#fff" fill-opacity=".85" />
  <path d="M50 29v13" stroke="#fff" stroke-width="2.5" stroke-linecap="round" />
  <circle cx="50" cy="44.5" r="3" fill="#fff" />
</svg>

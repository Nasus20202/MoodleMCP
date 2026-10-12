import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  // `pnpm dev` runs this next to `wrangler dev`; whatever the Worker serves is proxied to it.
  server: {
    proxy: Object.fromEntries(
      ['/api', '/mcp', '/oauth', '/.well-known'].map((path) => [path, 'http://localhost:8787']),
    ),
  },
  test: { name: 'web', include: ['src/**/*.test.ts'] },
});

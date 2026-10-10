import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  // `npm run dev` proxies the API to a locally running `wrangler dev`.
  server: { proxy: { '/api': 'http://localhost:8787', '/mcp': 'http://localhost:8787' } },
  test: { name: 'web', include: ['src/**/*.test.ts'] },
});

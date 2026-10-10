import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  // `npm run dev` proxies the API to a locally running `wrangler dev` / `go run .`
  server: { proxy: { '/api': 'http://localhost:8787', '/mcp': 'http://localhost:8787' } }
});

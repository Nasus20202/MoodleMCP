import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  build: {
    rollupOptions: {
      output: {
        // The server-rendered OAuth pages link the stylesheet, so it needs a stable name (see STYLESHEET_PATH).
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.css'))
            ? 'assets/app.css'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
  // `pnpm dev` runs this next to `wrangler dev`; whatever the Worker serves is proxied to it.
  server: {
    proxy: Object.fromEntries(
      ['/api', '/mcp', '/oauth', '/.well-known'].map((path) => [path, 'http://localhost:8787']),
    ),
  },
  test: { name: 'web', include: ['src/**/*.test.ts'] },
});

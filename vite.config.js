import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the built site works from any sub-path (e.g. GitHub Pages).
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
  worker: { format: 'es' },
});

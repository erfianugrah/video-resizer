import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  integrations: [
    react(),
    tailwind({
      applyBaseStyles: false,
    }),
  ],
  outDir: './dist',
  build: {
    // Ensure we generate assets that can be served by the Worker
    format: 'file',
    assets: 'assets',
  },
});
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// Dev/preview convenience only: `astro dev` has no /api routes (those are Vercel
// functions), so proxy them to production. Never active on Vercel builds.
const apiProxy = process.env.VERCEL
  ? undefined
  : {
      '/api': {
        target: 'https://theblueboard.co',
        changeOrigin: true,
      },
    };

export default defineConfig({
  output: 'static',
  outDir: 'dist',
  build: {
    format: 'file',
  },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: apiProxy,
    },
  },
});

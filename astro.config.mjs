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
    // Astro defaults Vite's envPrefix to PUBLIC_ only. The CARTO basemap key has shipped as
    // VITE_CARTO_BASEMAP_KEY since Sep 2026 (Vercel Production env, never committed), and
    // src/app/map/basemap.ts reads it through `import.meta.env`. Without VITE_ in this list the
    // expression inlines as undefined and every tile renders with an "API KEY REQUIRED"
    // watermark — a silent, build-green failure. Renaming the variable instead would orphan the
    // value already set on the Vercel project.
    envPrefix: ['PUBLIC_', 'VITE_'],
    server: {
      proxy: apiProxy,
    },
  },
});

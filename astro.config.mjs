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
    build: {
      // CSP is `script-src 'self'` with no nonce and no hashes. Astro inlines a
      // hoisted `<script src>` whose bundled chunk falls under this limit
      // (core/build/plugins/plugin-scripts.js), which would ship an inline
      // `<script type="module">` the browser then refuses to run. 0 keeps every
      // page script an external `_astro/` file.
      assetsInlineLimit: 0,
    },
    server: {
      proxy: apiProxy,
    },
  },
});

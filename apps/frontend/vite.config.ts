import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Repo-roten — .env läses därifrån så att alla workspaces delar samma fil. */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  // Plugin-ordningen spelar roll: router-pluginet måste köra före React-pluginet.
  plugins: [
    tanstackRouter({
      target: 'react',
      routesDirectory: './src/routes',
      generatedRouteTree: './src/route-tree.gen.ts',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        // The empty lifecycle worker is intentional: #36 owns caching.
        injectionPoint: undefined as never,
      },
      manifest: {
        name: 'Coach Clock',
        short_name: 'Coach Clock',
        description: 'Rättvisa byten vid sidlinjen.',
        lang: 'sv',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0a0a0a',
        theme_color: '#0a0a0a',
        icons: [
          {
            src: 'icons/coach-clock-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/coach-clock-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/coach-clock-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  envDir: repoRoot,
  optimizeDeps: {
    /*
     * autoCodeSplitting gör att route-komponenterna når sina beroenden först via
     * dynamisk import. Vites beroendeskanning hittar dem då inte vid kallstart,
     * utan optimerar dem först när rutten besöks — och laddar om sidan mitt i,
     * vilket loggar ett vilseledande "Invalid hook call" i konsolen. Paket som
     * bara används inne i rutter listas därför här.
     */
    include: ['lucide-react'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 5174 är frontendens reserverade port (fc-app 4173, backend 4002, Postgres 5434).
    port: 5174,
    strictPort: true,
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
});

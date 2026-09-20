import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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

import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { VitePWA } from 'vite-plugin-pwa';

// Cross-origin isolation unlocks SharedArrayBuffer, which lets the decoding
// workers write straight into the volume buffer instead of copying every
// frame. Everything still works without it, just slower — which is what
// happens on static hosts that cannot set response headers, GitHub Pages
// among them.
const isolationHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/**
 * The desktop build skips the service worker.
 *
 * Inside the Electron app the bundle is already on disk and already offline —
 * the worker has nothing left to cache. It also cannot register at all there:
 * the app is served over a scheme of its own, and service workers are only
 * allowed on http and https. Leaving it in throws on every launch.
 */
const isDesktop = process.env.CBCT_TARGET === 'desktop';

export default defineConfig({
  base: './',
  plugins: [
    wasm(),
    topLevelAwait(),
    react(),
    /**
     * Installable and usable offline.
     *
     * The program already runs entirely on the doctor's machine — the only
     * thing it needed the network for was fetching itself. Caching the bundle
     * makes it open with no connection at all, and «Установить» gives it a
     * window and an icon of its own instead of a browser tab among twenty.
     *
     * The bundle is large (Cornerstone and VTK), so the size limit is raised
     * to match rather than silently skipping the very file that matters.
     */
    ...(isDesktop ? [] : [VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['tooth.svg'],
      manifest: {
        name: 'Просмотр КЛКТ',
        short_name: 'КЛКТ',
        description:
          'Просмотр конусно-лучевой томографии челюстей: срезы, объём, панорама, срезы по зубам и заключение. Снимок не покидает компьютер.',
        lang: 'ru',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0a0a0a',
        theme_color: '#0a0a0a',
        icons: [
          { src: 'tooth.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,wasm}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    })]),
  ],
  resolve: {
    alias: [
      {
        find: '@icr/polyseg-wasm',
        replacement: path.resolve(__dirname, 'src/shims/polysegShim.ts'),
      },
      {
        // Keeps the polySeg web worker out of the bundle entirely. See the
        // shim for why the production build breaks without this.
        find: /^.*registerPolySegWorker$/,
        replacement: path.resolve(__dirname, 'src/shims/polysegWorkerShim.ts'),
      },
    ],
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        /**
         * Cornerstone and VTK are three quarters of the bundle and are not
         * touched until a study is opened, so they are split off: the upload
         * screen paints without waiting for the renderer to parse.
         *
         * They stay in *one* chunk together. Splitting them further is what
         * broke the production build before — @cornerstonejs/tools re-exports
         * its store through mutually dependent modules, and separating them
         * makes an import cycle across chunks that dies with «Cannot access
         * '…' before initialization».
         */
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('@cornerstonejs') || id.includes('@kitware') || id.includes('vtk.js')) {
              return 'imaging';
            }
            if (id.includes('jszip') || id.includes('dicom-parser')) return 'files';
          }
          return undefined;
        },
        // @cornerstonejs/tools re-exports its store through modules that
        // depend on each other, and a dynamic import (polySegConverters) puts
        // them in separate chunks. The resulting import cycle across chunks
        // breaks execution order — the built app dies on load with "Cannot
        // access '…' before initialization". Folding every module into one
        // chunk sidesteps it.
        // manualChunks: () => 'app',
      },
    },
  },
  worker: {
    plugins: () => [wasm(), topLevelAwait()],
    format: 'es',
  },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  optimizeDeps: {
    exclude: ['@icr/polyseg-wasm'],
  },
});

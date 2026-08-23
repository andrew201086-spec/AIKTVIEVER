import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [wasm(), topLevelAwait(), react()],
  resolve: {
    alias: {
      '@icr/polyseg-wasm': path.resolve(__dirname, 'src/shims/polysegShim.ts'),
    },
  },
  build: {
    target: 'esnext',
  },
  worker: {
    plugins: () => [wasm(), topLevelAwait()],
    format: 'es',
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  optimizeDeps: {
    exclude: ['@icr/polyseg-wasm'],
  },
});

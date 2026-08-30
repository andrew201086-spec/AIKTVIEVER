import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import wasm from 'vite-plugin-wasm';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  // Top-level await is emitted natively: the build targets esnext and the
  // worker output is an ES module, so no await transform is needed.
  plugins: [wasm(), react()],
  resolve: {
    alias: {
      '@icr/polyseg-wasm': path.resolve(__dirname, 'src/shims/polysegShim.ts'),
    },
  },
  build: {
    target: 'esnext',
  },
  worker: {
    plugins: () => [wasm()],
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

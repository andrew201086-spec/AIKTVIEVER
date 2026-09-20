import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Everything under test is pure geometry and parsing — no DOM needed, and
    // a node environment keeps the suite fast enough to run on every save.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

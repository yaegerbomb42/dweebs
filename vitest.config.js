import { defineConfig } from 'vitest/config';

// Vitest runs in the `node` environment on purpose: the unit tests cover pure maths and headless
// logic (no DOM, no WebGL). When the pure `src/sim/` lands, the sim tests run in this same suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text', 'lcov'],
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every package's tests run from the root in one process, in Node: the
    // engine's tests use the headless worklet harness and fake audio graph,
    // and the app's test its pure models, tables and write functions.
    include: [
      'packages/*/src/**/*.test.ts',
      // The library scripts' pure halves (import, sweep, bundle options).
      'packages/*/lib/**/*.test.mjs',
      // The worklet bundler's and the patch index's pure halves.
      'scripts/lib/**/*.test.mjs',
    ],
    environment: 'node',
  },
});

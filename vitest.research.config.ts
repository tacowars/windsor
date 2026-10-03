import { defineConfig } from 'vitest/config';

/**
 * The finished Tape research's tests, which re-check its saved measurements
 * (docs/log/2026-10-03-tape-research-tests-run-on-request.md). They run only
 * on request, with `npm run test:research`: never in the default suite,
 * `verify` or CI. The engine's own goldens pin the shipped Tape.
 */
export default defineConfig({
  test: {
    include: ['scripts/research/**/*.test.mjs'],
    environment: 'node',
  },
});

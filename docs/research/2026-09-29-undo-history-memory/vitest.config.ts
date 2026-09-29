// Runs `measure.test.ts` only, in one forked Node process with `gc` exposed.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: new URL('../../..', import.meta.url).pathname,
    include: ['docs/research/2026-09-29-undo-history-memory/measure.test.ts'],
    environment: 'node',
    pool: 'forks',
    execArgv: ['--expose-gc'],
  },
});

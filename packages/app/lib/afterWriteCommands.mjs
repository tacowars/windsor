/**
 * What to run after a patch file is written before `npm run verify` passes:
 * the sweep for the headroom record, the index, the formatter. The console
 * shows the same list (`src/libraryConstants.ts`'s `AFTER_WRITE_COMMANDS`);
 * `afterWriteCommands.test.mjs` pins the two equal (#620 decision 7).
 */
export const AFTER_WRITE_COMMANDS = [
  'node packages/app/sweep-headroom.mjs --stale',
  'node scripts/patch-library-index.mjs --write',
  'npx prettier --write packages/engine/src/patches',
];

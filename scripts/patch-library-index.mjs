#!/usr/bin/env node
/* global process, console, URL */
/**
 * `packages/client/src/audio/patches/index.ts`, generated from the files
 * beside it so the library's static-import table cannot drift (#561).
 * `--check` (the `npm run verify` mode) fails on a stale index or a file
 * that is not a patch; `--write` regenerates it. Pure half and its tests:
 * `scripts/lib/patchLibraryIndex.mjs`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { patchIdsIn, renderIndex } from './lib/patchLibraryIndex.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(root, 'packages/client/src/audio/patches');
const INDEX = join(DIR, 'index.ts');

function fail(message) {
  console.error(`patch-library-index: ${message}`);
  process.exit(1);
}

let next;
try {
  next = renderIndex(patchIdsIn(DIR));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const current = existsSync(INDEX) ? readFileSync(INDEX, 'utf8') : '';
if (process.argv.includes('--write')) {
  if (next !== current) writeFileSync(INDEX, next);
} else if (next !== current) {
  fail('patches/index.ts is stale — run `node scripts/patch-library-index.mjs --write`');
}
console.log(
  `patch-library-index: ${next.split('\n').filter((l) => l.startsWith('import ')).length} patch files`,
);

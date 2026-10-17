#!/usr/bin/env node
/* global process, console, URL */
/**
 * `packages/engine/src/patches/index.ts` and `packages/engine/src/racks/index.ts`,
 * generated from the files beside each so the banks' static-import tables
 * cannot drift (#561; the racks, windsor#877). `--check` (the `npm run verify`
 * mode) fails on a stale index or a file that is not a library file;
 * `--write` regenerates both. Pure half and its tests:
 * `scripts/lib/patchLibraryIndex.mjs`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BANKS, patchIdsIn, renderIndex } from './lib/patchLibraryIndex.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(root, 'packages/engine/src');

function fail(message) {
  console.error(`patch-library-index: ${message}`);
  process.exit(1);
}

const write = process.argv.includes('--write');
const counts = [];
for (const bank of BANKS) {
  const dir = join(SRC, bank.dir);
  const index = join(dir, 'index.ts');
  if (!existsSync(dir)) {
    if (!write)
      fail(`${bank.dir}/ is missing — run \`node scripts/patch-library-index.mjs --write\``);
    mkdirSync(dir);
  }
  let next;
  try {
    next = renderIndex(patchIdsIn(dir), bank);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const current = existsSync(index) ? readFileSync(index, 'utf8') : '';
  if (write) {
    if (next !== current) writeFileSync(index, next);
  } else if (next !== current) {
    fail(`${bank.dir}/index.ts is stale — run \`node scripts/patch-library-index.mjs --write\``);
  }
  const files = next.split('\n').filter((line) => line.startsWith('import ')).length;
  counts.push(`${files} ${bank.what} files`);
}
console.log(`patch-library-index: ${counts.join(', ')}`);

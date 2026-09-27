#!/usr/bin/env node
/* global process, console */
/**
 * The generated worklet files under `packages/engine/src/worklet/generated/`,
 * each bundled by esbuild from its source folder beside it (#643). Default
 * mode writes every file whose bundle changed; `--check` (the `npm run verify`
 * mode) writes nothing and fails on a generated file that differs from a fresh
 * bundle, which is a stale copy or a hand edit either way. The rows and the
 * esbuild settings are `scripts/lib/workletBundle.mjs`, with their tests.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  bundleWorklet,
  REBUILD_COMMAND,
  sourceDirOf,
  WORKLET_DIR,
  WORKLETS,
} from './lib/workletBundle.mjs';

const check = process.argv.includes('--check');
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
let stale = 0;

for (const worklet of WORKLETS) {
  const out = join(WORKLET_DIR, worklet.output);
  let next;
  try {
    next = await bundleWorklet(worklet);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (next === current) {
    console.log(`build-worklets: worklet/${worklet.output} is current (${kb(next.length)})`);
  } else if (check) {
    console.error(
      `build-worklets: worklet/${worklet.output} differs from a fresh bundle of worklet/${worklet.entry}. ` +
        `It is generated: edit the source under packages/engine/src/worklet/${sourceDirOf(worklet)}/ ` +
        `and run \`${REBUILD_COMMAND}\`, then commit the result.`,
    );
    stale++;
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, next);
    console.log(`build-worklets: wrote worklet/${worklet.output} (${kb(next.length)})`);
  }
}

if (stale) process.exit(1);

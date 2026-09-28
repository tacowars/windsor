/* global console */
/**
 * Rewrites every `packages/engine/src/patches/<id>.json` at this build's
 * format: each file through the library loader, which runs the format
 * upgrades (`patchMigrations.ts`) and fills a missing field from the
 * defaults, then through the one serialiser. Written for patch format 2
 * (windsor#60, record `2026-09-28-retire-the-headroom-record`), which retired
 * the headroom record and `userKey`, and kept for the next format bump in
 * place of the one-off migration scripts before it. Run from the repo root:
 *
 *     node packages/app/rewrite-patches.mjs
 *     npx prettier --write packages/engine/src/patches
 *     node scripts/patch-library-index.mjs --write
 *
 * Idempotent: a file already at this format, complete, comes back byte for
 * byte once prettier has run. A file the loader refuses stops the run, and
 * nothing after it is written.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { patchIdsIn } from '../../scripts/lib/patchLibraryIndex.mjs';
import { AUDIO_DIR, loadAudioExports } from './lib/audioBundle.mjs';

const PATCHES = join(AUDIO_DIR, 'patches');

const { loadPatchFile, serialisePatchFile } = await loadAudioExports(
  `
    export { loadPatchFile } from './patch/patchLibrary';
    export { serialisePatchFile } from './patch/patchFileSerialise';
  `,
  'rewrite-patches',
);

const ids = patchIdsIn(PATCHES);
for (const id of ids) {
  const path = join(PATCHES, `${id}.json`);
  const entry = loadPatchFile(id, JSON.parse(readFileSync(path, 'utf8')));
  writeFileSync(path, serialisePatchFile(entry));
}
console.log(
  `rewrite-patches: ${ids.length} files in ${PATCHES}; run \`npx prettier --write packages/engine/src/patches\``,
);

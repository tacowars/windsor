/* global console, process */
/**
 * Moves patch files the editor downloaded into the library (#563, epic #564
 * decision 5): without a folder grant, Save and Copy to new download
 * `<id>.json`, and this validates each with the library loader and copies it
 * into `packages/engine/src/patches/`. Run from the repo root:
 *
 *     node packages/app/import-patches.mjs [dir]
 *
 * `dir` defaults to `~/Downloads`. The loader is the library's own, and the
 * printed commands are what the index and the formatter need next.
 * The logic is `lib/importPatches.mjs`, tested there. Exit 1 means a file that
 * claims to be a patch was refused (#617); unrelated `.json` sitting in the
 * folder is skipped and leaves a clean import at 0.
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { AUDIO_DIR, loadAudioExports } from './lib/audioBundle.mjs';
import { importExitCode, importPatches } from './lib/importPatches.mjs';

const PATCHES = join(AUDIO_DIR, 'patches');
/** What a copied file needs before it is committed: the index lists it, prettier formats it. */
const NEXT_COMMANDS = [
  'node scripts/patch-library-index.mjs --write',
  'npx prettier --write packages/engine/src/patches',
];

const [dirArg] = process.argv.slice(2);
if (dirArg === '--help' || dirArg === '-h') {
  console.log('usage: node packages/app/import-patches.mjs [dir]   (default ~/Downloads)');
  process.exit(2);
}
const sourceDir = resolve(dirArg ?? join(homedir(), 'Downloads'));

const { loadPatchFile } = await loadAudioExports(
  `export { loadPatchFile } from './patch/patchLibrary';`,
  '563-import-patches',
);

const result = importPatches({ sourceDir, patchesDir: PATCHES, loadFile: loadPatchFile });
const { copied, rejected, skipped } = result;
for (const { id, file } of copied) console.log(`copied ${file} -> patches/${id}.json`);
for (const { file, reason } of skipped) console.log(`skipped ${file}: ${reason}`);
for (const { file, reason } of rejected) console.error(`rejected ${file}: ${reason}`);
if (copied.length === 0) {
  console.log(`import-patches: nothing to import from ${sourceDir}`);
  process.exit(importExitCode(result));
}
console.log(
  [
    `import-patches: ${copied.length} file${copied.length === 1 ? '' : 's'} into ${PATCHES}. Next:`,
    ...NEXT_COMMANDS.map((command) => `  ${command}`),
  ].join('\n'),
);
process.exit(importExitCode(result));

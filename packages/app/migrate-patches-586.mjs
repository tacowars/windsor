/* global console, process */
/**
 * The one-off #586 migration, kept for provenance like `migrate-patches-561.mjs`:
 * the first schema change since the library became files. `filter.modWheelDepth`
 * (octaves the mod wheel adds to `envAmount`) joined `FilterSettings`, and the
 * loader refuses a file missing a field, so every
 * `packages/client/src/audio/patches/<id>.json` gains `"modWheelDepth": 0` in
 * its `filter` — written through the shared serialiser, in `makePatch()`'s key
 * order — and its `headroom.contentHash` is recomputed in place.
 *
 *     node tools/patch-editor/migrate-patches-586.mjs [--spot-check=3]
 *     npx prettier --write packages/client/src/audio/patches
 *     node scripts/patch-library-index.mjs --write
 *
 * No re-sweep: a field at its default cannot change a render (the worklet's
 * normaliser already read the absent field as 0), so each file's `worstSeed`
 * and `peak` stay the sweep's own readings. The hash refresh is what keeps the
 * loader from calling the record stale. As the proof of that rule the script
 * re-renders `--spot-check` files (three by default) at their recorded seed
 * through the headroom render and refuses to finish if a peak differs from the
 * recorded one; the #586 PR proved all 114 against a pre-change capture
 * (`__fixtures__/patchLibraryRenders586.json`). This is the pattern for every
 * later schema change that adds a defaulted field
 * (`docs/log/2026-09-16-wheel-depth-per-destination-and-schema-migration-hash-refresh.md`).
 *
 * Idempotent: a file that already carries the field is left as it is.
 */
import { build } from 'esbuild';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIO = resolve(HERE, '../../packages/client/src/audio');
const PATCHES = join(AUDIO, 'patches');
const FIELD = 'modWheelDepth';
const DEFAULT = 0;
const AFTER = 'envAmount';

const spotArg = process.argv.find((a) => a.startsWith('--spot-check='));
const SPOT_CHECK = spotArg ? Number(spotArg.slice('--spot-check='.length)) : 3;

const output = resolve('node_modules/.cache-586-migrate.mjs');
await build({
  stdin: {
    contents: `
      export { patchContentHash, peakAt, serialisePatchFile } from './__fixtures__/headroomSweep';
      export { loadProcessor } from './__fixtures__/workletHarness';
    `,
    resolveDir: AUDIO,
    loader: 'ts',
  },
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  define: {
    'import.meta.url': JSON.stringify(pathToFileURL(join(AUDIO, '__fixtures__/entry.ts')).href),
  },
});
const { patchContentHash, peakAt, serialisePatchFile, loadProcessor } = await import(
  pathToFileURL(output).href
);

/** `filter` with the new field inserted after `envAmount`, matching `makePatch()`'s order. */
function withField(filter) {
  const next = {};
  for (const [key, value] of Object.entries(filter)) {
    next[key] = value;
    if (key === AFTER) next[FIELD] = DEFAULT;
  }
  if (!Object.hasOwn(next, FIELD)) throw new Error(`filter has no ${AFTER} to insert after`);
  return next;
}

const ids = readdirSync(PATCHES)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length))
  .sort();

let migrated = 0;
const spotCheck = [];
for (const id of ids) {
  const path = join(PATCHES, `${id}.json`);
  const file = JSON.parse(readFileSync(path, 'utf8'));
  if (Object.hasOwn(file.patch.filter, FIELD)) continue;
  file.patch.filter = withField(file.patch.filter);
  const before = file.headroom.contentHash;
  file.headroom = { ...file.headroom, contentHash: patchContentHash(file.patch) };
  writeFileSync(path, serialisePatchFile(file));
  migrated++;
  if (spotCheck.length < SPOT_CHECK) spotCheck.push({ id, file, before });
}

const dsp = loadProcessor();
for (const { id, file, before } of spotCheck) {
  const peak = peakAt(dsp, file.patch, file.headroom.worstSeed);
  if (peak !== file.headroom.peak)
    throw new Error(
      `${id}: seed ${file.headroom.worstSeed} renders ${peak}, recorded ${file.headroom.peak} — the field changed a render`,
    );
  console.log(
    `${id}: hash ${before} -> ${file.headroom.contentHash}; seed ${file.headroom.worstSeed} still peaks ${peak}`,
  );
}
console.log(`migrated ${migrated} of ${ids.length} files in ${PATCHES}`);
process.exit(0);

/* global console, process */
/**
 * The one-off #561 migration, kept for provenance: it wrote every
 * `packages/client/src/audio/patches/<id>.json` from the TypeScript preset
 * sources main held at 003998af (`presets.ts` and the `presets*.ts` group
 * files behind it, `presetCatalog.ts` for the metadata, the
 * `WORST_KNOWN_SEED` map in `fmProcessorHeadroom.test.ts` and
 * `__fixtures__/scoringHeadroom.json` for the headroom records).
 *
 *     node tools/patch-editor/migrate-patches-561.mjs
 *     npx prettier --write packages/client/src/audio/patches
 *     node scripts/patch-library-index.mjs --write
 *
 * Those sources were deleted in the same PR, so this script no longer runs;
 * the bit-identity proof is `patchLibraryIdentity.test.ts` against
 * `__fixtures__/patchLibraryBefore561.json`. Numbers were written with
 * `JSON.stringify` of the live values, never rounded (#543).
 *
 * Headroom: every seed is the recorded one, not a re-sweep. The peak is one
 * render at that seed with the headroom render (`__fixtures__/headroomSweep.ts`,
 * the render the test performs): the 14 original presets had a seed but no
 * recorded peak, and 7 of the 100 scoring peaks in `scoringHeadroom.json`
 * predate #543's top-of-travel level clamp and no longer matched what their
 * seed renders (the other 93 match bit for bit). `seedsSwept` is what each
 * group was actually swept with: 16,384 for the
 * originals (#78), 4,096 for `saw-arp` and `drone-sqr`
 * (`docs/log/2026-09-02-bass-digital-clip-headroom.md`), and
 * `scoringHeadroom.json`'s `seeds` (256) for the scoring bank (#475).
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIO = resolve(HERE, '../../packages/client/src/audio');
const PATCHES = join(AUDIO, 'patches');

const ORIGINAL_SEEDS = 16384;
const SLOW_SEEDS = 4096;
const SLOW_ORIGINALS = new Set(['saw-arp', 'drone-sqr']);
/** Verbatim from fmProcessorHeadroom.test.ts at 003998af: the #78 sweep's worst draws. */
const WORST_KNOWN_SEED = {
  'lead-bell': 8808,
  'pad-drift': 2181,
  'ai-voice': 11629,
  'sub-drone': 13714,
  'bass-digital': 12428,
  kick: 2765,
  snare: 953,
  hat: 6945,
  'weapon-zap': 1261,
  'horde-horn': 14891,
  'pickup-blip': 1566,
  'build-thunk': 11629,
  'saw-arp': 3684,
  'drone-sqr': 1367,
};

const output = resolve('node_modules/.cache-561-migrate.mjs');
await build({
  stdin: {
    contents: `
      export { PRESETS, PRESET_NAMES } from './presets';
      export { PRESET_CATALOG } from './presetCatalog';
      export { patchContentHash, peakAt } from './__fixtures__/headroomSweep';
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
const { PRESETS, PRESET_NAMES, PRESET_CATALOG, patchContentHash, peakAt, loadProcessor } =
  await import(pathToFileURL(output).href);

const scoring = JSON.parse(readFileSync(join(AUDIO, '__fixtures__/scoringHeadroom.json'), 'utf8'));
const dsp = loadProcessor();
mkdirSync(PATCHES, { recursive: true });

for (const id of PRESET_NAMES) {
  const patch = PRESETS[id];
  const metadata = PRESET_CATALOG[id];
  if (!patch || !metadata) throw new Error(`${id}: no patch or no catalogue entry`);
  let worstSeed;
  let seedsSwept;
  if (Object.hasOwn(scoring.results, id)) {
    worstSeed = scoring.results[id].seed;
    seedsSwept = scoring.seeds;
  } else if (Object.hasOwn(WORST_KNOWN_SEED, id)) {
    worstSeed = WORST_KNOWN_SEED[id];
    seedsSwept = SLOW_ORIGINALS.has(id) ? SLOW_SEEDS : ORIGINAL_SEEDS;
  } else {
    throw new Error(`${id}: no recorded headroom seed`);
  }
  const peak = peakAt(dsp, patch, worstSeed);
  const recorded = scoring.results[id]?.peak;
  if (recorded !== undefined && recorded !== peak)
    console.log(
      `${id}: recorded peak ${recorded} predates #543; seed ${worstSeed} renders ${peak}`,
    );
  const headroom = { worstSeed, peak, seedsSwept };
  const file = {
    format: 1,
    name: patch.name,
    category: metadata.category,
    tags: [...metadata.tags],
    description: metadata.description,
    patch,
    headroom: { ...headroom, contentHash: patchContentHash(patch) },
  };
  writeFileSync(join(PATCHES, `${id}.json`), JSON.stringify(file, null, 2) + '\n');
}
console.log(`wrote ${PRESET_NAMES.length} files to ${PATCHES}`);
process.exit(0);

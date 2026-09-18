/* global console, process, performance */
/**
 * Writes a patch file's `headroom` record from an offline clip sweep (#561):
 * the seed that produced the worst peak, that peak, the seed count, and a hash
 * of the patch so an edit cannot ride on a stale sweep. Run from the repo root:
 *
 *     node tools/patch-editor/sweep-headroom.mjs <id…> [--seeds <n>]
 *     node tools/patch-editor/sweep-headroom.mjs --stale [--seeds <n>]
 *
 * `--stale` sweeps every file whose record is missing or whose `contentHash`
 * no longer matches its patch. The default is 16,384 seeds — the sweep that
 * justified the original bank's volumes (#78) — and `--seeds` lowers it; the
 * count is recorded in the file as `seedsSwept`, so a lighter sweep is a
 * visible fact, not a hidden one. Per-patch wall time is printed because
 * #563's Save path calls this. The render is `__fixtures__/headroomSweep.ts`'s,
 * the same one `fmProcessorHeadroom.test.ts` performs on the recorded seed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { patchIdsIn } from '../../scripts/lib/patchLibraryIndex.mjs';
import { AUDIO_DIR, loadAudioExports } from './lib/audioBundle.mjs';

const PATCHES = join(AUDIO_DIR, 'patches');
const DEFAULT_SEEDS = 16384;

const args = process.argv.slice(2);
const seedsAt = args.indexOf('--seeds');
const seeds = seedsAt >= 0 ? Number(args[seedsAt + 1]) : DEFAULT_SEEDS;
if (!Number.isSafeInteger(seeds) || seeds < 1)
  throw new Error('--seeds must be a positive integer');
const stale = args.includes('--stale');
const named = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--seeds');
if (!stale && named.length === 0) {
  console.error('usage: node tools/patch-editor/sweep-headroom.mjs <id…|--stale> [--seeds <n>]');
  process.exit(2);
}

const { loadPatchFile, patchContentHash, seedRange, serialisePatchFile, sweepHeadroom } =
  await loadAudioExports(
    `export { loadPatchFile, patchContentHash, seedRange, serialisePatchFile, sweepHeadroom } from './__fixtures__/headroomSweep';`,
    '561-headroom-sweep',
  );

const readFile = (id) => JSON.parse(readFileSync(join(PATCHES, `${id}.json`), 'utf8'));
const isStale = (file) =>
  !file.headroom || file.headroom.contentHash !== patchContentHash(file.patch);

const ids = stale ? patchIdsIn(PATCHES).filter((id) => isStale(readFile(id))) : named;
if (ids.length === 0) {
  console.log('sweep-headroom: every record is current');
  process.exit(0);
}

for (const id of ids) {
  const file = readFile(id);
  // Validate everything but the record we are about to write: a placeholder
  // stands in so a brand-new file with no record yet is swept, not refused.
  const contentHash = patchContentHash(file.patch);
  loadPatchFile(id, { ...file, headroom: { worstSeed: 0, peak: 0, seedsSwept: 1, contentHash } });
  const started = performance.now();
  const { worstSeed, peak } = sweepHeadroom(file.patch, seedRange(seeds));
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  file.headroom = { worstSeed, peak, seedsSwept: seeds, contentHash: patchContentHash(file.patch) };
  writeFileSync(join(PATCHES, `${id}.json`), serialisePatchFile(file));
  const verdict = peak > 1 ? 'CLIPS' : 'ok';
  console.log(
    `${id}: seed ${worstSeed} peak ${peak.toFixed(4)} ${verdict} (${seeds} seeds, ${seconds}s)`,
  );
}
console.log(
  `sweep-headroom: wrote ${ids.length} record${ids.length === 1 ? '' : 's'}; run \`npx prettier --write packages/client/src/audio/patches\``,
);

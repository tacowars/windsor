/* global console, process, structuredClone */
/**
 * Writes the first built-in rack bank (windsor#878) from `bank.mjs`, one
 * command from the repository root:
 *
 *   node docs/research/2026-10-18-rack-bank/author.mjs [--check]
 *
 * Each recipe is read through the engine's own `loadRackFile`, so every
 * insert and the sequencer are filled from their kinds' defaults and the
 * file is refused if a value is out of range, and written with
 * `serialiseRackFile` and then Prettier, as `patchFileSerialise.ts` says
 * every library file is, to `packages/engine/src/racks/<id>.json`. The patch is
 * the built-in's own copy at the current patch format, renamed to the rack.
 * `--check` writes nothing and fails when a file differs from its recipe.
 * Afterwards run `node scripts/patch-library-index.mjs --write`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { ENGINE, bundleImport } from './engineBundle.mjs';
import { recipes } from './bank.mjs';

const m = await bundleImport(`
  export { PATCH_LIBRARY } from './patch/presets';
  export { PATCH_FILE_FORMAT, patchLeafDifferences } from './patch/patchLibrary';
  export { RACK_FILE_FORMAT, RACK_FILE_KIND, loadRackFile } from './rack/rackFile';
  export { serialiseRackFile } from './rack/rackFileSerialise';
  export { DEFAULT_DRIVE } from './inserts/driveInsert';
  export { DEFAULT_COMPRESSOR } from './inserts/compressorSpec';
  export { DEFAULT_FILTER } from './inserts/filterSpec';
  export { DEFAULT_DELAY } from './inserts/delaySpec';
  export { applyDelayPreset } from './inserts/delayPresets';
  export { DEFAULT_REVERB } from './inserts/reverbInsert';
  export { applyReverbPreset } from './inserts/reverbPresets';
  export { DEFAULT_ADVANCED_DRIVE } from './inserts/advancedDriveSpec';
  export { applyAdvancedDrivePreset } from './inserts/advancedDrivePresets';
  export { DEFAULT_CHORUS } from './inserts/chorusInsert';
  export { applyChorusPreset } from './inserts/chorusPresets';
  export { DEFAULT_ECHO } from './inserts/echoInsert';
  export { DEFAULT_ENSEMBLE } from './inserts/ensembleSpec';
  export { applyEnsemblePreset } from './inserts/ensemblePresets';
  export { DEFAULT_PUMP } from './inserts/pumpSpec';
  export { DEFAULT_PHASER } from './inserts/phaserSpec';
  export { applyPhaserPreset } from './inserts/phaserPresets';
  export { DEFAULT_TAPE } from './inserts/tapeSpec';
  export { applyTapePreset } from './inserts/tapePresets';
  export { hitStep, restStep } from './sequencing/chordSequencer';
`);

/** The raw file a recipe describes: the built-in patch renamed, its entry's metadata, the effect tags. */
function rawFile(recipe) {
  const entry = m.PATCH_LIBRARY[recipe.patchSource];
  if (!entry) throw new Error(`${recipe.id}: no built-in patch ${recipe.patchSource}`);
  const tags = [...new Set([...entry.tags, ...recipe.effectTags])];
  return {
    format: m.RACK_FILE_FORMAT,
    kind: m.RACK_FILE_KIND,
    name: recipe.name,
    category: entry.category,
    tags,
    description: recipe.description,
    patchFormat: m.PATCH_FILE_FORMAT,
    patch: { ...structuredClone(entry.patch), name: recipe.name },
    patchSource: recipe.patchSource,
    ...(recipe.lowCut !== undefined && { lowCut: recipe.lowCut }),
    sequencer: recipe.sequencer,
    inserts: recipe.inserts,
  };
}

/** The loaded entry as a file: what the serialiser writes. */
function fileOf(entry) {
  const file = { ...entry };
  delete file.id;
  delete file.problems;
  return file;
}

/** Loads `raw` and refuses a correction, a patch that is not the built-in's, or a slot key. */
function checked(recipe, raw) {
  const entry = m.loadRackFile(recipe.id, raw);
  const built = m.PATCH_LIBRARY[recipe.patchSource].patch;
  const leaves = m.patchLeafDifferences({ ...entry.patch, name: built.name }, built);
  const problems = [...entry.problems, ...leaves];
  if (problems.length) throw new Error(`${recipe.id}: ${problems.join('; ')}`);
  return entry;
}

const check = process.argv.includes('--check');
let stale = 0;
for (const recipe of recipes(m)) {
  const path = join(ENGINE, 'racks', `${recipe.id}.json`);
  const bytes = m.serialiseRackFile(fileOf(checked(recipe, rawFile(recipe))));
  // As every library writer's file is: the serialiser's bytes, then `prettier --write`.
  const text = await format(bytes, { ...(await resolveConfig(path)), filepath: path });
  checked(recipe, JSON.parse(text));
  if (check) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (current !== text) stale++;
    console.log(`${current === text ? 'ok   ' : 'STALE'} racks/${recipe.id}.json`);
  } else {
    writeFileSync(path, text);
    console.log(`wrote racks/${recipe.id}.json`);
  }
}
if (stale) process.exit(1);

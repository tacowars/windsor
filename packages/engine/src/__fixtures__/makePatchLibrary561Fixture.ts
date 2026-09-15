/**
 * Captures the whole factory bank as it was *before* #561 moved every patch
 * into `patches/*.json` — every `PRESETS` id with its full normalised `Patch`,
 * plus each id's category, tags and description from the hand-kept catalogue.
 *
 *     npx tsx packages/client/src/audio/__fixtures__/makePatchLibrary561Fixture.ts
 *     npx prettier --write packages/client/src/audio/__fixtures__/patchLibraryBefore561.json
 *
 * `patchLibrary.test.ts` compares the migrated library against this file field
 * by field with `Object.is`, so the numbers are written at full double
 * precision (`JSON.stringify` of the live values, never rounded — #543 showed a
 * rounding moved `bass-digital`'s transient by 10.5 dB). The output is a
 * snapshot of main at the commit named in the file, taken before the migration
 * landed; re-running it after the change would overwrite the "before" with the
 * "after" and make that test assert nothing. Only run it to move the reference
 * point on purpose, and say so in the ticket that does.
 *
 * Node-only, like everything in `__fixtures__/`: outside the client's tsc
 * build so browser code cannot reach it.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRESET_CATALOG } from '../presetCatalog';
import { PRESETS, PRESET_NAMES } from '../presets';

const HERE = dirname(fileURLToPath(import.meta.url));

const entries: Record<string, unknown> = {};
for (const id of PRESET_NAMES) {
  const patch = PRESETS[id];
  const metadata = PRESET_CATALOG[id];
  if (!patch) throw new Error(`no patch for ${id}`);
  if (!metadata) throw new Error(`no catalogue entry for ${id}`);
  entries[id] = {
    category: metadata.category,
    tags: [...metadata.tags],
    description: metadata.description,
    patch,
  };
}

const fixture = {
  note: 'Pre-#561 factory bank: every PRESETS id with its normalised Patch and its presetCatalog.ts metadata, captured from main at 003998af before the patches/*.json migration. Numbers are the live doubles, unrounded.',
  ids: PRESET_NAMES,
  entries,
};

const destination = join(HERE, 'patchLibraryBefore561.json');
writeFileSync(destination, JSON.stringify(fixture, null, 2) + '\n');
console.log(`wrote ${PRESET_NAMES.length} presets to ${destination}`);

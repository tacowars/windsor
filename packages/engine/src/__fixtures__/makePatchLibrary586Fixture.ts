/**
 * Captures what every library patch *renders* before #586 added
 * `filter.modWheelDepth`: each `patches/*.json` at its recorded headroom seed,
 * through the headroom render (`headroomSweep.ts`, the render the sweep and
 * the headroom test perform), reduced to a SHA-256 of the raw Float32 output.
 *
 *     npx tsx packages/client/src/audio/__fixtures__/makePatchLibrary586Fixture.ts
 *     npx prettier --write packages/client/src/audio/__fixtures__/patchLibraryRenders586.json
 *
 * A hash of the bytes, not the samples themselves: 114 patches × 400 blocks ×
 * 128 frames × 2 channels of Float32 is 47 MB of fixture. The hash is over the
 * IEEE-754 bit patterns, so it distinguishes everything `Object.is` does on a
 * finite sample (`-0` from `0`, one ulp from the next); a render with any
 * non-finite sample is refused before it is hashed. The #586 identity test
 * compared the migrated library on the new engine against this file per patch
 * and was retired in the same PR once it had passed (the #583 pattern: the
 * library is data the editor saves over, #564 decision 6, so a test pinning it
 * to a past capture fails on the first real edit). The proof lives in the PR's
 * history; this file and the fixture stay as the record. Re-running it would
 * overwrite the "before" with the "after", so do not.
 *
 * Node-only, like everything in `__fixtures__/`: outside the client's tsc
 * build so browser code cannot reach it.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PATCH_LIBRARY, PRESET_NAMES } from '../presets';
import { HEADROOM_RENDER, headroomEvents } from './headroomSweep';
import { loadProcessor, render } from './workletHarness';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface RenderRecord {
  /** The recorded `headroom.worstSeed` the render used. */
  seed: number;
  /** Interleaved stereo sample count. */
  samples: number;
  /** Largest absolute sample, as the sweep reads it. */
  peak: number;
  /** SHA-256 of the Float32 output's bytes. */
  sha256: string;
}

/** One patch's headroom render at `seed`, reduced to its record. */
export function renderRecord(
  dsp: ReturnType<typeof loadProcessor>,
  id: string,
  seed: number,
): RenderRecord {
  const entry = PATCH_LIBRARY[id];
  if (!entry) throw new Error(`no library entry for ${id}`);
  const result = render(
    dsp,
    dsp.create(entry.patch, HEADROOM_RENDER.voices, seed),
    HEADROOM_RENDER.blocks,
    headroomEvents(),
  );
  if (result.nonFinite) throw new Error(`${id}: non-finite output at seed ${seed}`);
  const bytes = new Uint8Array(
    result.samples.buffer,
    result.samples.byteOffset,
    result.samples.byteLength,
  );
  return {
    seed,
    samples: result.samples.length,
    peak: result.peak,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const dsp = loadProcessor();
  const entries: Record<string, RenderRecord> = {};
  for (const id of PRESET_NAMES) {
    const entry = PATCH_LIBRARY[id];
    if (!entry) throw new Error(`no library entry for ${id}`);
    entries[id] = renderRecord(dsp, id, entry.headroom.worstSeed);
  }

  const fixture = {
    note: 'Pre-#586 library renders: every patches/*.json at its recorded headroom seed through the headroom render, as a SHA-256 of the Float32 output bytes, captured from main at a6953a0b before filter.modWheelDepth existed.',
    render: HEADROOM_RENDER,
    ids: PRESET_NAMES,
    entries,
  };

  const destination = join(HERE, 'patchLibraryRenders586.json');
  writeFileSync(destination, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`wrote ${PRESET_NAMES.length} render records to ${destination}`);
}

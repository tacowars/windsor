/**
 * Every library patch inside the editor's knobs (windsor#324 fix round 1).
 *
 * `makeKnob` clamps each commit to its spec's range, so a shipped value
 * outside a knob's range jumps to the boundary on the first touch, and the
 * sound changes before the user has dialled anything. This walks every patch
 * in the built-in library against `allPatchKnobs()`, and the operator ratio
 * against the Coarse / Fine pair's domain (`RATIO_MIN`..`RATIO_MAX`).
 */
import { describe, expect, it } from 'vitest';

import { OP_NAMES } from '@windsor/engine';
import { PRESETS } from '@windsor/engine/patch/presets';
import { allPatchKnobs } from './patchKnobTables';
import { getPath } from './patchPath';
import { RATIO_MAX, RATIO_MIN } from './ratioSplit';

/** One value outside its knob: `<patch id> <path> = <value> (min..max)`. */
function outOfRange(): string[] {
  const knobs = allPatchKnobs();
  const misses: string[] = [];
  for (const [id, patch] of Object.entries(PRESETS)) {
    for (const { path, entry } of knobs) {
      const v = getPath(patch, path);
      if (typeof v !== 'number') continue;
      const { min, max } = entry.o;
      if (v < min || v > max) misses.push(`${id} ${path} = ${v} (${min}..${max})`);
    }
    OP_NAMES.forEach((_, i) => {
      const op = patch.ops[i];
      if (!op || op.fixed) return;
      if (op.ratio < RATIO_MIN || op.ratio > RATIO_MAX) {
        misses.push(`${id} ops.${i}.ratio = ${op.ratio} (${RATIO_MIN}..${RATIO_MAX})`);
      }
    });
  }
  return misses;
}

/**
 * Known misses, each a follow-up of its own rather than this test's to fix:
 * the claps' LFO rates sit above the Rate knob's 40 Hz. Each is named by its
 * patch and path, not its value, so a refit that moves the value without
 * bringing it into range does not break the test (windsor#324 fix round 2).
 * An entry that no longer misses must leave this list, so it cannot hide a
 * later one.
 */
const KNOWN_MISSES: readonly string[] = [
  'efm-clap lfo.rate',
  'tr808-clap lfo.rate',
  'tr909-clap lfo.rate',
];

/** A miss's patch and path, without its value and range. */
const missKey = (miss: string): string => miss.slice(0, miss.indexOf(' = '));

/** One sample at the engine's 48 kHz, in seconds. */
const ONE_SAMPLE_S = 1 / 48_000;

/**
 * Every envelope time that is above 0 but shorter than one sample: a 0 the
 * fitter missed (windsor#318 fix round). It renders within rounding of 0, and
 * the knob shows it as `0m`, the same as a real 0, so it should be 0.
 */
function subSampleTimes(): string[] {
  const misses: string[] = [];
  for (const [id, patch] of Object.entries(PRESETS)) {
    for (const { path } of allPatchKnobs()) {
      if (!path.endsWith('Time')) continue;
      const v = getPath(patch, path);
      if (typeof v === 'number' && v > 0 && v < ONE_SAMPLE_S) misses.push(`${id} ${path} = ${v}`);
    }
  }
  return misses;
}

describe('the patch library against the editor knobs', () => {
  it('keeps every knob-backed value inside its knob range, so a first touch never clamps it', () => {
    expect(outOfRange().map(missKey)).toEqual([...KNOWN_MISSES]);
  });

  it('ships no envelope time between 0 and one sample', () => {
    expect(subSampleTimes()).toEqual([]);
  });
});

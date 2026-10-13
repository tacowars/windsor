/**
 * A part's wave sets (windsor#656): each operator's mip set for the bound
 * patch at the part's rate, `null` for the waves that read none (Noise, Saw
 * D, Square D), and, while a synced note may need them, the same built at
 * twice the rate (`sets2x`), each table normalised to the part's own table
 * of its octave (`getMips`'s `baseRate`). Invariant: built at a patch
 * message, never in a render; a voice reads `sets` or `sets2x` by the rate
 * its note took. `synth/fmProcessorOversample.test.ts` pins the choice;
 * `waveTables.test.ts` the tables.
 *
 * The main thread reads it too (windsor#795): which waves read a set
 * (`readsWaveSet`) and whether a patch's notes take twice the rate
 * (`patchOversamples`), so `synth/waveSetSender.ts` builds the sets a patch
 * needs and sends them ahead of it, and `installWaveSets` takes them in. It
 * touches no worklet scope at load.
 */

import type { Patch } from '../../patch/patch';
import type { WaveSetEntry } from '../../synth/workletMessages';
import { SYNC_OVERSAMPLE } from './fmConstants';
import { OPERATOR_COUNT } from './patchDefaults';
import { WAVE } from './waveIds';
import { getMips, installWaveSet, warmWaveCache } from './waveTables';

/** Whether a note of `patch` runs at twice the rate: a synced operator, and none fed or Noise. */
function patchOversamples(patch: Pick<Patch, 'ops'>): boolean {
  let synced = false;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const op = patch.ops[i]!;
    if (op.wave === WAVE.NOISE || op.feedback !== 0) return false;
    if (op.sync !== 'off') synced = true;
  }
  return synced;
}

/** Whether an operator of `wave` reads a mip set: every wave but Noise, Saw D and Square D. */
function readsWaveSet(wave: number): boolean {
  return wave !== WAVE.NOISE && wave !== WAVE.SAW_D && wave !== WAVE.SQUARE_D;
}

/** Install the sets the main thread sent (a `waves` message, or `ProcessorOptions.waves`), if any. */
function installWaveSets(sets: readonly WaveSetEntry[] | undefined): void {
  if (!sets) return;
  for (let i = 0; i < sets.length; i++) installWaveSet(sets[i]!.key, sets[i]!);
}

class PartWaveSets {
  /** Each operator's set at the part's rate. */
  sets: (Float32Array[] | null)[];
  /** Each operator's set at twice the rate, or null where no note needs one. */
  sets2x: (Float32Array[] | null)[];
  /** The part's switch: false keeps every voice at 1×, so no set at twice the rate is built. */
  allowed: boolean;

  constructor(allowed: boolean) {
    this.sets = [null, null, null, null];
    this.sets2x = [null, null, null, null];
    this.allowed = allowed;
  }

  /**
   * The sets for `patch` at `rate` and, while allowed, at twice it when a
   * note of `patch` would take it or `sounding2x`, a voice sounding at it,
   * may rebind to `patch`.
   */
  rebuild(patch: Patch, rate: number, sounding2x: boolean): void {
    const twice = this.allowed && (patchOversamples(patch) || sounding2x);
    for (let i = 0; i < OPERATOR_COUNT; i++) {
      const op = patch.ops[i]!;
      const none = !readsWaveSet(op.wave);
      this.sets[i] = none ? null : getMips(op.wave, rate, patch.tone, op.userPartials);
      this.sets2x[i] =
        none || !twice
          ? null
          : getMips(op.wave, SYNC_OVERSAMPLE * rate, patch.tone, op.userPartials, rate);
    }
  }
}

export { PartWaveSets, installWaveSets, patchOversamples, readsWaveSet, warmWaveCache };

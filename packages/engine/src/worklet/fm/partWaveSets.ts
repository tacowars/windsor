/**
 * A part's wave sets (windsor#656): each operator's mip set for the bound
 * patch at the part's rate, `null` for the waves that read none (Noise, Saw
 * D, Square D), and, while a synced note may need them, the same built at
 * twice the rate (`sets2x`), each table normalised to the part's own table
 * of its octave (`getMips`'s `baseRate`). Invariant: built at a patch
 * message, never in a render; a voice reads `sets` or `sets2x` by the rate
 * its note took. `synth/fmProcessorOversample.test.ts` pins the choice;
 * `waveTables.test.ts` the tables.
 */

import type { Patch } from '../../patch/patch';
import { SYNC_OVERSAMPLE } from './fmConstants';
import { OPERATOR_COUNT } from './patchDefaults';
import { WAVE } from './waveIds';
import { getMips } from './waveTables';

class PartWaveSets {
  /** Each operator's set at the part's rate. */
  sets: (Float32Array[] | null)[];
  /** Each operator's set at twice the rate, or null where no note needs one. */
  sets2x: (Float32Array[] | null)[];

  constructor() {
    this.sets = [null, null, null, null];
    this.sets2x = [null, null, null, null];
  }

  /** The sets for `patch` at `rate`, and at twice it when `twice`. */
  rebuild(patch: Patch, rate: number, twice: boolean): void {
    for (let i = 0; i < OPERATOR_COUNT; i++) {
      const op = patch.ops[i]!;
      const none = op.wave === WAVE.NOISE || op.wave === WAVE.SAW_D || op.wave === WAVE.SQUARE_D;
      this.sets[i] = none ? null : getMips(op.wave, rate, patch.tone, op.userPartials);
      this.sets2x[i] =
        none || !twice
          ? null
          : getMips(op.wave, SYNC_OVERSAMPLE * rate, patch.tone, op.userPartials, rate);
    }
  }
}

export { PartWaveSets };

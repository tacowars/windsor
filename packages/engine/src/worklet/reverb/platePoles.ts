/**
 * The plate's one-pole coefficients (#671), once a block: the input's
 * low-pass and high-pass and the tank's damping low-pass and high-pass, each
 * cut from its parameter in Hz and capped below Nyquist. Moved out of
 * `tank.ts` (windsor#766) when the written-out output taps took that file past
 * its size limit; the arithmetic is the one the tank ran, so
 * `mixer/reverbGolden.test.ts` pins it unchanged. Invariant: no allocation,
 * and only arrays cross the call, since a coefficient returned from a call V8
 * does not inline is a new heap number (worklet/CLAUDE.md rule 2).
 */

import { CUTOFF_CEILING } from './reverbConstants';

/** The parameters the block's one-pole coefficients are cut from, in `_poles` order. */
const POLE_CUTS = ['inputHighCut', 'inputLowCut', 'tankHighCut', 'tankLowCut'];

/** Each one-pole coefficient for this block's cutoffs in Hz, into `poles`: one call for all four. */
function poleCoefficients(parameters: Record<string, Float32Array>, poles: Float64Array): void {
  for (let k = 0; k < POLE_CUTS.length; k++) {
    const hz = parameters[POLE_CUTS[k]][0];
    // −(2π f / rate), negated outside: the same bits as (−2π f) / rate.
    poles[k] =
      1 - Math.exp(-((2 * Math.PI * Math.min(hz, sampleRate * CUTOFF_CEILING)) / sampleRate));
  }
}

export { poleCoefficients };

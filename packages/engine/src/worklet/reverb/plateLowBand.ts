/**
 * The plate's low band (windsor#748): below `lowCross` the tank decays over
 * Decay × `lowDecay` while the rest keeps Decay. The same maths as the Retro
 * Reverb's (`worklet/retro/retroLowBand.ts`, read, never imported, so that
 * reverb stays bit for bit): at each of the tank's eight gain points
 * (`tankGains.ts`) the sample is split by a trapezoidal (bilinear) one-pole
 * lowpass at `lowCross` and its complement, and the low part takes the gain
 * for an RT60 of Decay × `lowDecay`. As a first-order shelf, g x + (gL − g) lp:
 * exactly gL at DC and exactly g at Nyquist, and between the two everywhere
 * else, so it never exceeds the larger, which is under 1.
 *
 * `configureLowBand` runs once a block from `configureGains`, against the
 * block's gain targets: the extra low gain (gL − g) per point, ramped across
 * the block as the gains are, and the lowpass's coefficient. gL is cut from
 * the band's own target through the measured correction at that target
 * (`decayCorrection.ts`), never from the broadband Decay's corrected value
 * times `lowDecay`: the correction climbs with the RT60 asked, so the
 * broadband factor leaves a long low band short (fix round 2 of PR
 * windsor#750). Both gains are cut for the same length: each moving
 * all-pass's target length less its excursion (`_modExcursion`, windsor#764). The shelf itself is written out in the tank's sample loop at
 * each point (`tank.ts`), never called per sample (worklet rule 6).
 *
 * At `lowDecay` exactly 1, once any ramp back has landed, the band is off:
 * nothing of it runs per sample and the tank takes its plain gain, to the bit
 * (`mixer/reverbLowBand.test.ts` pins it against `lowBand: false`). Coming
 * on, each lowpass starts from the sample circulating at its point, not from
 * wherever it last stopped. HOLD bypasses the band's output, not its state:
 * the extra gains ramp to 0 while each lowpass keeps tracking at its real
 * coefficient, so releasing HOLD steps nothing, as the tank's damping filters
 * do (`tank.ts`, above `dampLp`).
 *
 * Nothing is allocated and no double crosses a call (worklet rule 2); the
 * prewarp is `tanInPlace`, the same bits on arm64 and x64
 * (`fm/portableTangent.ts`), so an edit there rebuilds this bundle too.
 */

import { tanInPlace } from '../fm/portableTangent';
import { correctDecay } from './decayCorrection';
import { CUTOFF_CEILING, FIRST_TANK_LINE, RT60_LOG } from './reverbConstants';
import type { DattorroReverb } from './reverbProcessor';

/** Samples a quantum: each ramp crosses one. */
const QUANTUM = 128;

/**
 * This block's extra low gains and their per-sample steps, against the gain
 * targets `configureGains` has just set, and whether the band runs
 * (`plate._band`). Returns whether any extra gain moves this block.
 */
function configureLowBand(
  plate: DattorroReverb,
  parameters: Record<string, Float32Array>,
  held: boolean,
  immediate: boolean,
): boolean {
  const extra = plate._lowExtra;
  const target = plate._lowExtraTarget;
  const step = plate._lowExtraStep;
  const lowDecay = parameters.lowDecay[0];
  const on = plate._lowBandEnabled && lowDecay !== 1;
  let landed = true;
  for (let p = 0; p < extra.length; p++) {
    extra[p] = target[p];
    if (extra[p] !== 0) landed = false;
  }
  // Off and every extra gain landed on 0: the tank's plain gain is the whole point.
  if (!on && landed) {
    plate._band = false;
    return false;
  }
  if (!plate._band) plate._seedBand = true;
  plate._band = true;

  const tangent = plate._tangent;
  tangent[0] =
    (Math.PI * Math.min(parameters.lowCross[0], sampleRate * CUTOFF_CEILING)) / sampleRate;
  tanInPlace(tangent, 0);
  plate._cross = tangent[0] / (1 + tangent[0]);

  // The band's own target through its own correction, at the block's Size.
  plate._rt60 = parameters.decay[0] * lowDecay;
  correctDecay(plate);
  const perSample = RT60_LOG / (plate._rt60 * sampleRate);
  const gains = plate._gainTarget;
  let ramping = false;
  for (let p = 0; p < extra.length; p++) {
    // The same effective length as the broadband gain: each moving line, less its excursion.
    const length = plate._lengthTarget[p + FIRST_TANK_LINE] - plate._modExcursion[p];
    target[p] = on && !held ? Math.exp(-perSample * length) - gains[p] : 0;
    if (immediate) extra[p] = target[p];
    step[p] = (target[p] - extra[p]) / QUANTUM;
    if (step[p] !== 0) ramping = true;
  }
  return ramping;
}

export { configureLowBand };

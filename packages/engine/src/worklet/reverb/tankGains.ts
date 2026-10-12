/**
 * The tank's gain points (windsor#748): Decay is an RT60 in seconds, charged on
 * every segment of the loop. Each tank line, lines 4 to 11, has one gain point:
 * the long lines (5, 7, 9, 11) at their output, where the old feedback gain
 * sat, and the all-pass lines (4, 6, 8, 10) inside their all-pass, on the
 * delayed sample both of its sums read. A line `L` samples long at the block's
 * Size takes g = 10^(−3L / (Decay × rate)), so a sample loses 60 dB over Decay
 * seconds whichever segments it spends them in, the all-passes' own
 * recirculation included: every delay z^−L of the loop becomes (r z^−1)^L with
 * r = 10^(−3 / (Decay × rate)). With all the loss at one point, energy held in
 * the all-passes would skip it and outlast the setting.
 *
 * `configureGains` runs once a block, before the sample loop: it lands the last
 * block's ramp on its targets, aims each gain at this block's Decay and Size
 * through the measured correction (`decayCorrection.ts`; HOLD's `HOLD_GAINS`
 * while held), and hands the low band its block
 * (`plateLowBand.ts`). The tank ramps each gain across the block a sample at a
 * time, so a Decay step, a Size move or HOLD never steps the loop. Invariants:
 * nothing allocated, no double across a call (worklet rule 2). Pinned by
 * `mixer/reverbGolden.test.ts`; the T30 against Decay by
 * `mixer/reverbDecay.test.ts`.
 */

import { correctDecay } from './decayCorrection';
import { configureLowBand } from './plateLowBand';
import {
  DECAY_SECONDS,
  FIRST_TANK_LINE,
  HOLD_GAINS,
  RT60_LOG,
  TANK_DELAYS,
} from './reverbConstants';
import type { DattorroReverb } from './reverbProcessor';

/** Samples a quantum: each ramp crosses one. */
const QUANTUM = 128;

/**
 * The gain points' and the low band's state, from the processor's
 * constructor, after its double fields are first written as NaN (worklet
 * rule 7). The first block sets the gains outright.
 */
function makeGainPoints(plate: DattorroReverb): void {
  plate._gain = new Float64Array(TANK_DELAYS.length);
  plate._gainTarget = new Float64Array(TANK_DELAYS.length);
  plate._gainStep = new Float64Array(TANK_DELAYS.length);
  plate._gainsPrimed = false;
  plate._ramping = false;
  plate._band = false;
  plate._seedBand = false;
  plate._lowExtra = new Float64Array(TANK_DELAYS.length);
  plate._lowExtraTarget = new Float64Array(TANK_DELAYS.length);
  plate._lowExtraStep = new Float64Array(TANK_DELAYS.length);
  plate._lowState = new Float64Array(TANK_DELAYS.length);
  plate._cross = 0;
  plate._rt60 = DECAY_SECONDS[0];
  plate._cell = 0;
  plate._cellAt = 0;
  plate._tangent = new Float64Array(1);
}

/**
 * This block's gain targets and per-sample steps, from `decay` through its
 * measured correction (`decayCorrection.ts`) and the lines' target lengths
 * (`_applySize` has run). The first block after construction or sleep sets
 * the gains outright: the tank is empty, so nothing can step.
 */
function configureGains(
  plate: DattorroReverb,
  parameters: Record<string, Float32Array>,
  held: boolean,
): void {
  const gain = plate._gain;
  const target = plate._gainTarget;
  const step = plate._gainStep;
  const immediate = !plate._gainsPrimed;
  plate._rt60 = parameters.decay[0];
  correctDecay(plate);
  const perSample = RT60_LOG / (plate._rt60 * sampleRate);
  let ramping = false;
  for (let p = 0; p < gain.length; p++) {
    // The last block's ramp ends on its target exactly, not on 128 rounded adds.
    gain[p] = target[p];
    target[p] = held
      ? HOLD_GAINS[p]
      : Math.exp(-perSample * plate._lengthTarget[p + FIRST_TANK_LINE]);
    if (immediate) gain[p] = target[p];
    step[p] = (target[p] - gain[p]) / QUANTUM;
    if (step[p] !== 0) ramping = true;
  }
  plate._gainsPrimed = true;
  plate._ramping = configureLowBand(plate, parameters, held, immediate) || ramping;
}

export { configureGains, makeGainPoints };

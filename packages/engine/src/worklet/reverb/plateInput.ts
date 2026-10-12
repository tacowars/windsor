/* eslint-disable no-magic-numbers -- DSP: the quantum of 128 is the algorithm; the tunables are reverbConstants.ts (#671) */
/**
 * The plate's input write (windsor#763), once a quantum before the tank
 * renders: each input channel into its own pre-delay ring, at unity, and the
 * dry output. A one-channel input feeds both rings, so a mono source fills
 * both halves of the tank, and no input writes zeros into both. The rings are
 * read back at the one `preDelay` in `tank.ts`'s sample loop, each through
 * its own input filters and diffusers. A function over the processor,
 * installed on its prototype by `reverbProcessor.ts`, as the tank is.
 * Invariant: no allocation (`set` and `fill` write in place).
 * `mixer/reverbStereo.test.ts` holds a one-channel input to the render of
 * the same signal on both channels; `mixer/reverbGolden.test.ts` pins it.
 */

import type { DattorroReverb } from './reverbProcessor';

/**
 * Each input channel into its pre-delay ring at unity (windsor#763), and the
 * dry output. A one-channel input feeds both rings, and no input feeds zeros.
 * It reads `dry` from the parameters itself, so no double crosses the call.
 */
function _writeInput(
  this: DattorroReverb,
  input: Float32Array[],
  output: Float32Array[],
  parameters: Record<string, Float32Array>,
): void {
  const dry = parameters.dry[0];
  const left = output[0];
  const right = output[1];
  const at = this._preDelayWrite;

  if (input.length >= 2) {
    this._preDelay.set(input[0], at);
    this._preDelayRight.set(input[1], at);
    for (let i = 0; i < 128; i++) {
      left[i] = input[0][i] * dry;
      right[i] = input[1][i] * dry;
    }
  } else if (input.length === 1) {
    this._preDelay.set(input[0], at);
    this._preDelayRight.set(input[0], at);
    for (let i = 0; i < 128; i++) {
      left[i] = right[i] = input[0][i] * dry;
    }
  } else {
    this._preDelay.fill(0, at, at + 128);
    this._preDelayRight.fill(0, at, at + 128);
  }
}

export { _writeInput };

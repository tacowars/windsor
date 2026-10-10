/**
 * One conversion point of the Retro reverb: the input's, or one wet output's. The converter clips
 * to ±1 and truncates to `converterSteps` (12 bits); Character blends the clean and converted
 * samples. Linear is that quantiser alone, today's path to the bit.
 *
 * Gain ranging (RV-6), as the Lexicon 224 and EMT 250 era converters had: the same 12-bit
 * quantiser behind a gain of 2^range, 0 to `rangingSteps` steps of 6 dB, scaled back down after
 * it, so a quiet tail keeps its resolution and its noise floor steps with its level instead of
 * truncating to zero at -66 dBFS.
 *
 * The detector: the gain falls at once, a step at a time, on the sample that would clip the
 * range, and a new window starts. A window lasts at least `rangingHoldSeconds`; it closes at the
 * first zero crossing after that, where the truncation's error is at most the sample itself, so
 * a step there hides. Then the gain rises as many steps as the window's peak allows while staying
 * `rangingCeiling` under full scale: 6 dB of hysteresis against the step down. No dither: zero in
 * is zero out, so a tail still ends in exact zeros, now under -96 dBFS.
 *
 * `ranging` is the share of the ranging quantiser against the linear one, set per block (the DSP
 * smooths a switch); at exactly 0 the detector does not run. `tick` turns `input` into `output`:
 * fields, not an argument and a result, which V8 boxes across a call it does not inline (worklet
 * rule 2). Every double field is first written as NaN (rule 7). `inserts/retroReverbDsp.test.ts`
 * pins the tail it keeps, `retroReverbNeutralPin.test.ts` the linear path and
 * `retroReverbAllocation.test.ts` that it allocates nothing.
 */
import { RETRO_REVERB_DSP as C } from '../../inserts/retroReverbConstants';

/** Internal ticks a window lasts at least. */
const HOLD_TICKS = Math.round(C.rangingHoldSeconds * C.rate);

class RetroConverter {
  input: number;
  output: number;
  /** Character: 0 is the clean sample, 1 the converted one. */
  character: number;
  /** 0 linear, 1 ranging; between, a switch in progress. */
  ranging: number;
  /** The gain's step, 0 to `rangingSteps`, and the gain, 2^range. */
  range: number;
  gain: number;
  /** Ticks into the current window, and the largest clipped magnitude in it. */
  hold: number;
  peak: number;
  /** The last clipped sample, for the zero crossing. */
  previous: number;

  constructor() {
    this.input = this.output = this.character = this.ranging = this.gain = NaN;
    this.peak = this.previous = NaN;
    this.input = this.output = this.character = this.ranging = 0;
    this.range = this.hold = 0;
    this.gain = 1;
    this.peak = this.previous = 0;
  }

  /** Unity gain and a fresh window, as a switch to ranging or a clear starts the detector. */
  reset(): void {
    this.range = this.hold = 0;
    this.gain = 1;
    this.peak = this.previous = 0;
  }

  tick(): void {
    const bounded = Math.max(-1, Math.min(1, this.input));
    const quantized = Math.trunc(bounded * C.converterSteps) / C.converterSteps;
    if (this.ranging === 0) {
      this.output = bounded + this.character * (quantized - bounded);
      return;
    }
    const magnitude = Math.abs(bounded);
    if (magnitude * this.gain >= 1 && this.range > 0) {
      while (this.range > 0 && magnitude * this.gain >= 1) {
        this.range--;
        this.gain /= 2;
      }
      this.hold = 0;
      this.peak = magnitude;
    } else if (magnitude > this.peak) this.peak = magnitude;
    if (this.hold < HOLD_TICKS) this.hold++;
    else if (bounded * this.previous <= 0) {
      while (this.range < C.rangingSteps && this.peak * this.gain * 2 <= C.rangingCeiling) {
        this.range++;
        this.gain *= 2;
      }
      this.hold = 0;
      this.peak = magnitude;
    }
    this.previous = bounded;
    const steps = this.gain * C.converterSteps;
    const ranged = Math.trunc(bounded * steps) / steps;
    const blended = quantized + this.ranging * (ranged - quantized);
    this.output = bounded + this.character * (blended - bounded);
  }
}

export { RetroConverter };

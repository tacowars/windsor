/**
 * Low decay (RV-5): the tank's low band, below Low cross, decays over Decay × Low decay while the
 * rest keeps Decay. This file owns the band's block-rate state; `retroTank.ts` runs it a sample at
 * a time. Tested through `inserts/retroReverbDsp.test.ts` (the RT60 in each band) and
 * `retroReverbAllocation.test.ts`.
 *
 * Each line's feedback is split by a one-pole lowpass at Low cross and its complement, and the low
 * part takes the gain for an RT60 of Decay × Low decay where the rest takes the line's own gain for
 * Decay: per-line absorption as in Jot & Chaigne (1991), a first-order shelf
 * `gain + (lowGain - gain) × lowpass` on each line. The lowpass is the trapezoidal (bilinear)
 * one-pole, whose zero sits at the internal clock's Nyquist, so the shelf is exactly the low gain at
 * DC and exactly the line's gain at Nyquist, and its magnitude lies between the two everywhere: it
 * never exceeds the larger, which is under 1 for any Decay × Low decay up to 80 s. Like the line
 * gains, both are set once a block from the block's Size.
 *
 * Density's taps (RV-3) sit on their line's decay envelope through a weight from the line's gain,
 * and its loudness match reads the ends' energy from a table at the block's Decay. With two bands
 * each needs the band's own: the low band's taps are weighted by the low gains and matched from
 * `RETRO_REVERB_DENSITY_LOW_LEVEL` at Decay × Low decay (0.05 to 80 s; its header says why the low
 * band has a table of its own), and the difference between the two bands' mixes (ends and taps)
 * is run through the same lowpass at each output and added, so the low band plays its own mix and
 * the rest today's.
 *
 * Off (Low decay exactly 1, or the tank's share under the floor) nothing here runs and the tank's
 * path is today's, to the bit. Samples cross in fields, never arguments or results (worklet rule
 * 2); every double field is first written as one (rule 7).
 */
import { RETRO_REVERB_DSP as C } from '../../inserts/retroReverbConstants';
import { RETRO_REVERB_DENSITY_LOW_LEVEL } from '../../inserts/retroReverbDensityTables';
import { RetroDensityLevel } from './retroDensityLevel';
import type { RetroTank } from './retroTank';

/** The block's settings the band reads (`RetroReverbDsp`, through the tank). */
interface RetroLowSettings {
  /** The block's Size: the target of any Size move, as the line gains are. */
  size: number;
  decay: number;
  tone: number;
  lowDecay: number;
  lowCross: number;
}

class RetroLowBand {
  /** The split runs: Low decay is not 1 and the tank plays. */
  on: boolean;
  /** The block's settings, kept by `configure` for `weigh`. */
  size: number;
  decay: number;
  tone: number;
  lowDecay: number;
  lowCross: number;
  /** The lowpass's coefficient at Low cross: g / (1 + g), g = tan(π × Low cross / rate). */
  cross: number;
  /** Per line: the low band's gain, that less the line's gain, and the feedback lowpass's state. */
  lineGains: Float64Array;
  lineExtras: Float64Array;
  lineStates: Float64Array;
  /**
   * Density's low band: per tap, its low gain less its gain in each output; the ends' likewise;
   * the low band's ends' energy in taps (at Decay × Low decay); the sums a sample; and each
   * output's lowpass state.
   */
  tapExtrasLeft: Float64Array;
  tapExtrasRight: Float64Array;
  endExtraLeft: number;
  endExtraRight: number;
  level: RetroDensityLevel;
  tapLeft: number;
  tapRight: number;
  stateLeft: number;
  stateRight: number;

  constructor(lines: number, taps: number) {
    this.lineGains = new Float64Array(lines);
    this.lineExtras = new Float64Array(lines);
    this.lineStates = new Float64Array(lines);
    this.tapExtrasLeft = new Float64Array(taps);
    this.tapExtrasRight = new Float64Array(taps);
    this.level = new RetroDensityLevel(RETRO_REVERB_DENSITY_LOW_LEVEL);
    this.on = false;
    this.size = this.decay = this.tone = this.lowDecay = this.lowCross = this.cross = NaN;
    this.endExtraLeft = this.endExtraRight = this.tapLeft = this.tapRight = NaN;
    this.stateLeft = this.stateRight = NaN;
    this.size = this.decay = this.lowDecay = 1;
    this.tone = this.lowCross = this.cross = 0;
    this.endExtraLeft = this.endExtraRight = this.tapLeft = this.tapRight = 0;
    this.stateLeft = this.stateRight = 0;
  }

  /** The block's gains and coefficient against the tank's line `gains`; `on` says whether to run. */
  configure(settings: RetroLowSettings, on: boolean, gains: Float64Array): void {
    // Coming on, the lowpasses start from silence rather than from where they last stopped.
    if (on && !this.on) for (let i = 0; i < this.lineStates.length; i++) this.lineStates[i] = 0;
    this.on = on;
    if (!on) return;
    this.size = settings.size;
    this.decay = settings.decay;
    this.tone = settings.tone;
    this.lowDecay = settings.lowDecay;
    this.lowCross = settings.lowCross;
    const warped = Math.tan((Math.PI * this.lowCross) / C.rate);
    this.cross = warped / (1 + warped);
    const decay = this.decay * this.lowDecay;
    for (let i = 0; i < gains.length; i++) {
      this.lineGains[i] = Math.pow(C.decayTarget, (C.tankSeconds[i] * this.size) / decay);
      this.lineExtras[i] = this.lineGains[i] - gains[i];
    }
  }

  /**
   * The low band's tap and end gains, once a block after the tank's own (`RetroTank.weighTaps`):
   * the same envelope weight and loudness match, from the low gains at Decay × Low decay.
   */
  weigh(tank: RetroTank): void {
    const level = this.level;
    level.point[0] = this.tone;
    level.point[1] = this.size;
    level.point[2] = this.decay * this.lowDecay;
    level.match();
    let left = 0,
      right = 0;
    for (let k = 0; k < this.tapExtrasLeft.length; k++) {
      const weight =
        tank.density *
        Math.min(
          Math.pow(this.lineGains[tank.tapLines[k]], tank.tapFractions[k] - 1),
          C.densityMaxBoost,
        );
      this.tapExtrasLeft[k] = tank.tapSignsLeft[k] * weight;
      this.tapExtrasRight[k] = tank.tapSignsRight[k] * weight;
      left += this.tapExtrasLeft[k] * this.tapExtrasLeft[k];
      right += this.tapExtrasRight[k] * this.tapExtrasRight[k];
    }
    const endLeft = C.outputTrim / Math.sqrt(1 + left * level.left);
    const endRight = C.outputTrim / Math.sqrt(1 + right * level.right);
    for (let k = 0; k < this.tapExtrasLeft.length; k++) {
      this.tapExtrasLeft[k] = this.tapExtrasLeft[k] * endLeft - tank.tapGainsLeft[k];
      this.tapExtrasRight[k] = this.tapExtrasRight[k] * endRight - tank.tapGainsRight[k];
    }
    this.endExtraLeft = endLeft - tank.endLeft;
    this.endExtraRight = endRight - tank.endRight;
  }
}

export { RetroLowBand };
export type { RetroLowSettings };

/* eslint-disable no-magic-numbers -- DSP: the TPT filter's polynomial and clamps are the algorithm; the tunables are fmConstants.ts (#654) */
/**
 * The per-voice filter (#644): a TPT state-variable filter (Simper topology)
 * giving lowpass, highpass, bandpass and notch from one structure, and its
 * dormancy test (#547). Its drive left it for the voice's own drive stage,
 * `voiceDrive.ts`, which kept the soft clip (windsor#300). Invariant:
 * `process` is the hot path — no allocation, coefficients only at control
 * rate. `setCoeffs` reads its cutoff and Q from `cutoffHz` and `q`, so no
 * double crosses the call (windsor#233: a double passed to a call V8 does not
 * inline is a new heap number on the audio thread).
 * `fmProcessorDormancy.test.ts` pins `Svf.quiet`; the golden test pins the
 * arithmetic. The Formant mode (windsor#331) runs three of these as bandpass
 * peaks, `process`'s bandpass written out in both render loops, and keeps
 * each peak's gain and level here beside its coefficients.
 * `tuneSvfSections` tunes the serial modes' sections, the 24 dB slope's
 * second one included (windsor#595); the voice (`updateVoiceFilter`,
 * `voiceControl.ts`) calls it, and the filter insert shares it.
 * Second consumer: the Filter insert (`worklet/filter/`, windsor#622).
 */

import { DORMANT_FILTER_STATE, SVF24_SECOND_STAGE_Q } from './fmConstants';
import { FILT_BP, FILT_HP, FILT_LP, FILT_NOTCH } from './modeIds';

/* ------------------------------------------------------------------ *
 * Filter — TPT / zero-delay-feedback state variable (Simper topology).
 * One structure yields lowpass, highpass, bandpass and notch, stays stable up
 * to Nyquist, and costs a handful of multiply-adds per sample.
 * ------------------------------------------------------------------ */

class Svf {
  ic1: number;
  ic2: number;
  a1: number;
  a2: number;
  a3: number;
  k: number;
  /** `setCoeffs`'s inputs. */
  cutoffHz: number;
  q: number;
  /**
   * As one of the Formant mode's three peaks (windsor#331, `voiceFormant.ts`):
   * its gain into the sum, and its level, in dB and as a gain, as last tuned.
   */
  gain: number;
  levelDb: number;
  level: number;

  constructor() {
    // Rule 7: each double field is born a double (NaN), before its start value (windsor#233).
    this.ic1 = this.ic2 = this.a1 = this.a2 = this.a3 = this.k = this.cutoffHz = this.q = NaN;
    this.gain = this.levelDb = this.level = NaN;
    this.ic1 = 0;
    this.ic2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.a3 = 0;
    this.k = 0;
    this.cutoffHz = 0;
    this.q = 0;
    this.gain = 0;
    this.level = 0;
  }

  reset(): void {
    this.ic1 = 0;
    this.ic2 = 0;
  }

  /** Both integrators below the dormancy floor: the filter has stopped ringing (#547). */
  static quiet(svf: Svf): boolean {
    return Math.abs(svf.ic1) <= DORMANT_FILTER_STATE && Math.abs(svf.ic2) <= DORMANT_FILTER_STATE;
  }

  /** Recompute coefficients for `cutoffHz` and `q`. Called at control rate, not per sample. */
  setCoeffs(sampleRate: number): void {
    const q = this.q;
    const nyq = sampleRate * 0.5;
    let fc = this.cutoffHz;
    if (fc < 20) fc = 20;
    if (fc > nyq * 0.98) fc = nyq * 0.98;
    const g = Math.tan((Math.PI * fc) / sampleRate);
    const k = 1 / Math.max(0.5, q);
    this.k = k;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  process(v0: number, mode: number): number {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    switch (mode) {
      case FILT_LP:
        return v2;
      case FILT_HP:
        return v0 - this.k * v1 - v2;
      case FILT_BP:
        return v1;
      case FILT_NOTCH:
        return v0 - this.k * v1;
      default:
        return v0;
    }
  }
}

/**
 * The serial modes' sections for `rate` (Hz): `a` from its own `cutoffHz`
 * and `q`, and at the 24 dB slope `b` too, following `a`'s cutoff at
 * `SVF24_SECOND_STAGE_Q`, so only the first is resonant (windsor#595).
 * Control rate; allocates nothing, and no double crosses the call.
 */
function tuneSvfSections(a: Svf, b: Svf, slope24: boolean, rate: number): void {
  a.setCoeffs(rate);
  if (slope24) {
    b.cutoffHz = a.cutoffHz;
    b.q = SVF24_SECOND_STAGE_Q;
    b.setCoeffs(rate);
  }
}

export { Svf, tuneSvfSections };

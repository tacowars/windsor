/**
 * The per-voice filter (#644): a TPT state-variable filter (Simper topology)
 * giving lowpass, highpass, bandpass and notch from one structure, its
 * dormancy test (#547), and the soft clip its drive runs through. Invariant:
 * `process` is the hot path — no allocation, coefficients only at control
 * rate. `fmProcessorDormancy.test.ts` pins `Svf.quiet`; the golden test pins
 * the arithmetic.
 */

import { DORMANT_FILTER_STATE } from './fmConstants.js';

/* ------------------------------------------------------------------ *
 * Filter — TPT / zero-delay-feedback state variable (Simper topology).
 * One structure yields lowpass, highpass, bandpass and notch, stays stable up
 * to Nyquist, and costs a handful of multiply-adds per sample.
 * ------------------------------------------------------------------ */

const FILT_OFF = 0,
  FILT_LP = 1,
  FILT_HP = 2,
  FILT_BP = 3,
  FILT_NOTCH = 4;

class Svf {
  constructor() {
    this.ic1 = 0;
    this.ic2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.a3 = 0;
    this.k = 0;
  }

  reset() {
    this.ic1 = 0;
    this.ic2 = 0;
  }

  /** Both integrators below the dormancy floor: the filter has stopped ringing (#547). */
  static quiet(svf) {
    return Math.abs(svf.ic1) <= DORMANT_FILTER_STATE && Math.abs(svf.ic2) <= DORMANT_FILTER_STATE;
  }

  /** Recompute coefficients. Called at control rate, not per sample. */
  setCoeffs(cutoffHz, q, sampleRate) {
    const nyq = sampleRate * 0.5;
    let fc = cutoffHz;
    if (fc < 20) fc = 20;
    if (fc > nyq * 0.98) fc = nyq * 0.98;
    const g = Math.tan((Math.PI * fc) / sampleRate);
    const k = 1 / Math.max(0.5, q);
    this.k = k;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  process(v0, mode) {
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

/** Cheap odd-symmetric saturator for filter drive. */
function softClip(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  return (x * (27 + x * x)) / (27 + 9 * x * x);
}

export { FILT_OFF, FILT_LP, FILT_HP, FILT_BP, FILT_NOTCH, Svf, softClip };

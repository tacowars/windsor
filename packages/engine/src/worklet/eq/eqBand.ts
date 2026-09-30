/**
 * One Parametric EQ band on the audio thread (windsor#198): its glides, its
 * type/slope/on crossfade, its coefficients and its stereo TDF-II state.
 *
 * Owns: frequency, gain and Q gliding on a one-pole (frequency and Q in log),
 * advanced one refresh step (`EQ_DSP.refreshFrames`) at a time and only while
 * some value still moves; the coefficients recomputed after each step through
 * the shared `inserts/eqCoefficients.ts`, and not at all once settled; a
 * change of type, slope or on fading the band's contribution out, switching
 * with the state cleared, and fading back in (smoothstep, `bandFadeSeconds`
 * each way); and the sections run in place over a work buffer, state in
 * doubles.
 *
 * Invariants: nothing here allocates after the constructor; a band that is
 * off, or a bell or shelf settled at exactly 0 dB, reports `idle` and holds
 * zero state, so it can be skipped and later resume without a transient.
 * Every field keeps the representation the constructor gives it (worklet
 * rule 7): V8 types a field by its first value, so a double first written as
 * a small integer is a Smi field until its first fraction, and that write
 * generalises it, deprecating the class's map and deoptimising the code that
 * reads it, which boxes every double until V8 optimises it again (`fade` took
 * its first fraction at the first type, slope or on change). So a double
 * field is first written as a double (NaN until the first block snaps it). Pinned
 * by `inserts/eqDsp.test.ts` and `eqAllocation.test.ts` through the shipped
 * bundle.
 */
import type { EqBandDesign } from '../../inserts/eqAnalog';
import { designEqBand } from '../../inserts/eqCoefficients';
import {
  EQ_BOUNDS,
  EQ_DSP as D,
  EQ_FIRST_ORDER_SLOPE,
  EQ_FLAT_Q,
  EQ_TYPE_ID as T,
} from '../../inserts/eqConstants';

const PER = D.coefficientsPerSection;
const ST = D.statePerSection;

export class EqBand {
  sampleRate: number;
  coeffs: Float64Array;
  /** The coefficients before the last refresh: a gliding piece ramps from these. */
  from: Float64Array;
  /** The last refresh changed the coefficients, and the next piece ramps to them. */
  ramp: boolean;
  state: Float64Array;
  sections: number;
  /** The coefficients' current values; type and slope are the ones playing. */
  design: EqBandDesign;
  on: boolean;
  /** Written by the processor each block, then applied by `retarget`. */
  nextType: number;
  nextSlope: number;
  nextOn: boolean;
  nextFreq: number;
  nextGain: number;
  nextQ: number;
  targetFreq: number;
  targetQ: number;
  targetLogFreq: number;
  targetLogQ: number;
  logFreq: number;
  logQ: number;
  moving: boolean;
  /** A type, slope or on change waits for the fade-out to finish. */
  pending: boolean;
  /** The fade's linear phase, 0 (band out) to 1 (band in), and its direction. */
  fade: number;
  fadeDir: number;
  fadeStep: number;
  glideStep: number;
  maxFreq: number;
  /** State has been written since it was last cleared. */
  dirty: boolean;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.coeffs = new Float64Array(D.maxSections * PER);
    this.from = new Float64Array(D.maxSections * PER);
    this.ramp = false;
    this.state = new Float64Array(D.maxSections * ST);
    this.sections = 0;
    // Every double is first written as a double (see the header): NaN until
    // the first block snaps it, and a first-order cut's held Q starts flat.
    this.design = { type: T.bell, slope: EQ_FIRST_ORDER_SLOPE, freq: NaN, gain: NaN, q: NaN };
    this.on = false;
    this.nextType = T.bell;
    this.nextSlope = EQ_FIRST_ORDER_SLOPE;
    this.nextOn = false;
    this.nextFreq = this.nextQ = this.nextGain = NaN;
    this.targetFreq = NaN;
    this.targetQ = EQ_FLAT_Q;
    this.targetLogFreq = this.targetLogQ = NaN;
    this.logFreq = this.logQ = NaN;
    this.moving = this.pending = this.dirty = false;
    this.fade = NaN;
    this.fadeDir = 0;
    this.fadeStep = 1 / (D.bandFadeSeconds * sampleRate);
    this.glideStep = 1 - Math.exp(-D.refreshFrames / (D.smoothSeconds * sampleRate));
    this.maxFreq = sampleRate * D.maxFrequencyRatio;
  }

  /** Apply the `next*` values: glide toward them, or fade to a new type, slope or on. */
  retarget(snap: boolean): void {
    this.targetFreq = Math.min(Math.max(this.nextFreq, EQ_BOUNDS.freq[0]), this.maxFreq);
    const firstOrder = this.isCut(this.nextType) && this.nextSlope === EQ_FIRST_ORDER_SLOPE;
    // A 6 dB/oct cut ignores Q: hold it rather than glide through identical coefficients.
    if (!firstOrder) this.targetQ = Math.min(Math.max(this.nextQ, EQ_BOUNDS.q[0]), EQ_BOUNDS.q[1]);
    this.targetLogFreq = Math.log(this.targetFreq);
    this.targetLogQ = Math.log(this.targetQ);
    const d = this.design;
    const changed =
      this.nextType !== d.type || this.nextSlope !== d.slope || this.nextOn !== this.on;
    const off = d.freq !== this.targetFreq || d.q !== this.targetQ || d.gain !== this.nextGain;
    if (snap) {
      if (changed || off || this.fadeDir !== 0) this.finish(true);
      return;
    }
    if (changed && !this.audible()) return this.switchNow();
    if (changed) {
      this.pending = true;
      this.fadeDir = -1;
    } else if (this.pending) {
      this.pending = false;
      this.fadeDir = this.on ? 1 : 0;
    }
    this.moving =
      Math.abs(this.targetLogFreq - this.logFreq) > D.settleLog ||
      Math.abs(this.targetLogQ - this.logQ) > D.settleLog ||
      Math.abs(this.nextGain - d.gain) > D.settleDb;
    if (!this.moving && off) this.settle();
  }

  isCut(type: number): boolean {
    return type === T.lowcut || type === T.highcut;
  }

  /** The band is heard: on, or fading in or out. */
  audible(): boolean {
    return this.on || this.fadeDir !== 0;
  }

  /** Nothing to run: off and silent, or a bell or shelf settled at exactly 0 dB. */
  idle(): boolean {
    if (!this.audible()) return true;
    const d = this.design;
    const gainType = !this.isCut(d.type) && d.type !== T.notch;
    return gainType && d.gain === 0 && !this.moving;
  }

  /** Take the next type, slope and on now, with the glides snapped and the state cleared. */
  switchNow(): void {
    this.design.type = this.nextType;
    this.design.slope = this.nextSlope;
    this.on = this.nextOn;
    this.pending = false;
    this.fade = 0;
    this.fadeDir = this.on ? 1 : 0;
    this.clear();
    this.settle();
  }

  /** Snap every glide to its target and design once. */
  settle(): void {
    this.moving = false;
    this.logFreq = this.targetLogFreq;
    this.logQ = this.targetLogQ;
    this.design.freq = this.targetFreq;
    this.design.q = this.targetQ;
    this.design.gain = this.nextGain;
    this.sections = designEqBand(this.design, this.sampleRate, this.coeffs, 0);
    this.ramp = false;
  }

  /** One refresh step of the glides, then new coefficients (or the settled ones). */
  glide(): void {
    const k = this.glideStep;
    const d = this.design;
    this.from.set(this.coeffs);
    this.logFreq += k * (this.targetLogFreq - this.logFreq);
    this.logQ += k * (this.targetLogQ - this.logQ);
    d.gain += k * (this.nextGain - d.gain);
    const settled =
      Math.abs(this.targetLogFreq - this.logFreq) <= D.settleLog &&
      Math.abs(this.targetLogQ - this.logQ) <= D.settleLog &&
      Math.abs(this.nextGain - d.gain) <= D.settleDb;
    if (settled) this.settle();
    else {
      d.freq = Math.exp(this.logFreq);
      d.q = Math.exp(this.logQ);
      this.sections = designEqBand(d, this.sampleRate, this.coeffs, 0);
    }
    this.ramp = true;
  }

  /**
   * Complete any fade and glide at once: the first block, silent input, or the
   * EQ while bypassed. `force` takes the next type, slope and on as well.
   */
  finish(force = false): void {
    if (force || this.pending) this.switchNow();
    this.fade = this.on ? 1 : 0;
    this.fadeDir = 0;
    if (this.moving) this.settle();
  }

  clear(): void {
    if (this.dirty) this.state.fill(0);
    this.dirty = false;
  }

  /** Advance the fade by `frames`; a finished fade-out switches and starts the fade-in. */
  step(frames: number): void {
    if (this.fadeDir === 0) return;
    this.fade += this.fadeDir * this.fadeStep * frames;
    if (this.fade >= 1) {
      this.fade = 1;
      this.fadeDir = 0;
    } else if (this.fade <= 0) {
      this.fade = 0;
      if (this.pending) this.switchNow();
      else this.fadeDir = 0;
    }
  }

  /** Flush state below the threshold; true when every word is zero. */
  flush(): boolean {
    if (!this.dirty) return true;
    const s = this.state;
    let clear = true;
    for (let i = 0; i < s.length; i++) {
      if (Math.abs(s[i]) < D.flushThreshold) s[i] = 0;
      else clear = false;
    }
    if (clear) this.dirty = false;
    return clear;
  }
}

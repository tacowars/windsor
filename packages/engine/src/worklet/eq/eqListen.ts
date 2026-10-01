/**
 * Listen on drag on the audio thread (windsor#200, record
 * `2026-09-30-parametric-eq-insert` decision 9): while the console holds a
 * band, the EQ's output is a band-pass of its input at that band's frequency
 * and Q (Q no lower than `EQ_LISTEN.minQ`), so only what the band covers is
 * heard. Live only: the port carries the band, the spec never does.
 *
 * Owns: the band asked for (`nextBand`, −1 off) and the band heard (`band`);
 * one stereo band-pass section (the cookbook's, 0 dB at its centre) whose
 * frequency and Q glide toward the band's targets on the EQ's own one-pole,
 * a quantum at a time, with the coefficients ramped across the quantum; and
 * the crossfade against the full EQ's output (smoothstep,
 * `EQ_LISTEN.fadeSeconds`). A new band fades the old one out first, then
 * starts from cleared state.
 *
 * Invariants: nothing allocates after the constructor; while `band` is −1
 * nothing here runs and the EQ's output is untouched, and the EQ itself runs
 * on underneath throughout, so once a listen fades out the output is the full
 * EQ's to the bit. Every double field is first written as a double (worklet
 * rule 7). Pinned by `inserts/eqListen.test.ts` and `eqAllocation.test.ts`
 * through the shipped bundle.
 */
import {
  EQ_DSP as D,
  EQ_LISTEN as L,
  EQ_MATH as M,
  EQ_SECTION as X,
} from '../../inserts/eqConstants';
import type { EqBand } from './eqBand';

export class EqListen {
  sampleRate: number;
  /** The band the port asked for (−1: the full EQ), applied by `retarget`. */
  nextBand: number;
  /** The band heard now, fading or full; −1 while nothing is heard. */
  band: number;
  /** The section's coefficients, and the ones a quantum's ramp starts from. */
  coeffs: Float64Array;
  from: Float64Array;
  state: Float64Array;
  /** The section's frequency and Q in log, gliding toward the band's targets. */
  logFreq: number;
  logQ: number;
  logMinQ: number;
  /** A listen has started, and its first quantum takes the band's values at once. */
  snap: boolean;
  /** The crossfade's linear phase, 0 (the full EQ) to 1 (the band-pass), and its direction. */
  mix: number;
  mixDir: number;
  mixStep: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.nextBand = L.off;
    this.band = L.off;
    this.coeffs = new Float64Array(D.coefficientsPerSection);
    this.from = new Float64Array(D.coefficientsPerSection);
    this.state = new Float64Array(D.statePerSection);
    // Doubles first written as doubles, NaN until a listen starts (see the header).
    this.logFreq = this.logQ = NaN;
    this.logMinQ = Math.log(L.minQ);
    this.snap = false;
    this.mix = NaN;
    this.mixDir = 0;
    this.mixStep = 1 / (L.fadeSeconds * sampleRate);
  }

  /** Apply the port's band: start one, fade back to the band held, or fade out. */
  retarget(): void {
    if (this.band < 0) {
      if (this.nextBand >= 0) this.start();
      return;
    }
    if (this.nextBand !== this.band) this.mixDir = -1;
    else this.mixDir = this.mix < 1 ? 1 : 0;
  }

  /**
   * Begin on `nextBand` from silence, the state cleared; the next `glide`
   * snaps to the band's values. Nothing here computes a double: this runs
   * once a listen, too seldom for V8 to optimise, and unoptimised code boxes
   * every double it makes.
   */
  start(): void {
    this.band = this.nextBand;
    this.state.fill(0);
    this.snap = true;
    this.mix = 0;
    this.mixDir = 1;
  }

  /**
   * One quantum's glide toward `band`'s targets, `frames` long, and the
   * coefficients at its end; the first quantum of a listen snaps to them.
   */
  glide(band: EqBand, frames: number): void {
    this.from.set(this.coeffs);
    const toFreq = Math.log(band.targetFreq);
    const toQ = Math.max(Math.log(band.targetQ), this.logMinQ);
    if (this.snap) {
      this.snap = false;
      this.logFreq = toFreq;
      this.logQ = toQ;
      this.design();
      this.from.set(this.coeffs);
      return;
    }
    if (Math.abs(toFreq - this.logFreq) <= D.settleLog && Math.abs(toQ - this.logQ) <= D.settleLog)
      return;
    const k = 1 - Math.exp(-frames / (D.smoothSeconds * this.sampleRate));
    this.logFreq += k * (toFreq - this.logFreq);
    this.logQ += k * (toQ - this.logQ);
    this.design();
  }

  /** The band-pass at `logFreq` and `logQ` into `coeffs` (a0 = 1). */
  design(): void {
    const w = (2 * Math.PI * Math.exp(this.logFreq)) / this.sampleRate;
    const alpha = Math.sin(w) / (2 * Math.exp(this.logQ));
    const a0 = 1 + alpha;
    const c = this.coeffs;
    c[X.b0] = alpha / a0;
    c[X.b1] = 0;
    c[X.b2] = -alpha / a0;
    c[X.a1] = -(2 * Math.cos(w)) / a0;
    c[X.a2] = (1 - alpha) / a0;
  }

  /**
   * Mix the band-pass of the input into the EQ's output, in place: the
   * section runs over `inL` / `inR` with its coefficients ramped from `from`
   * to `coeffs`, and the crossfade's gain follows a smoothstep of its phase.
   */
  process(
    bands: EqBand[],
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
  ): void {
    const frames = outL.length;
    this.glide(bands[this.band], frames);
    const c = this.coeffs;
    const f = this.from;
    const s = this.state;
    const inv = 1 / frames;
    const d0 = (c[X.b0] - f[X.b0]) * inv;
    const d2 = (c[X.b2] - f[X.b2]) * inv;
    const e1 = (c[X.a1] - f[X.a1]) * inv;
    const e2 = (c[X.a2] - f[X.a2]) * inv;
    let b0 = f[X.b0];
    let b2 = f[X.b2];
    let a1 = f[X.a1];
    let a2 = f[X.a2];
    let l1 = s[X.left1];
    let l2 = s[X.left2];
    let r1 = s[X.right1];
    let r2 = s[X.right2];
    const mix = this.mix;
    const step = this.mixDir * this.mixStep;
    for (let i = 0; i < frames; i++) {
      b0 += d0;
      b2 += d2;
      a1 += e1;
      a2 += e2;
      // The band-pass's b1 is zero.
      const xl = inL[i];
      const yl = b0 * xl + l1;
      l1 = -a1 * yl + l2;
      l2 = b2 * xl - a2 * yl;
      const xr = inR[i];
      const yr = b0 * xr + r1;
      r1 = -a1 * yr + r2;
      r2 = b2 * xr - a2 * yr;
      const phase = mix + step * (i + 1);
      const t = phase < 0 ? 0 : phase > 1 ? 1 : phase;
      const g = t * t * (M.three - 2 * t);
      outL[i] = outL[i] + g * (yl - outL[i]);
      outR[i] = outR[i] + g * (yr - outR[i]);
    }
    s[X.left1] = Math.abs(l1) < D.flushThreshold ? 0 : l1;
    s[X.left2] = Math.abs(l2) < D.flushThreshold ? 0 : l2;
    s[X.right1] = Math.abs(r1) < D.flushThreshold ? 0 : r1;
    s[X.right2] = Math.abs(r2) < D.flushThreshold ? 0 : r2;
    this.mix = Math.min(1, Math.max(0, mix + step * frames));
    if (this.mixDir > 0 && this.mix === 1) this.mixDir = 0;
    if (this.mixDir < 0 && this.mix === 0) this.end();
  }

  /** Faded out: the listen ends, or the next band starts. */
  end(): void {
    this.band = L.off;
    this.mixDir = 0;
    if (this.nextBand >= 0) this.start();
  }
}

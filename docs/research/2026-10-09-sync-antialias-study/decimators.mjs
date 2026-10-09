/**
 * The decimation filters of windsor#652's study, and the code that runs them.
 * Research only.
 *
 * - `B2`: candidate B at 2×, the 65-tap Blackman-windowed sinc the drive's
 *   oversampler uses (`worklet/advancedDrive/driveOversample.ts`, cutoff
 *   0.235 of its rate), 96 → 48 kHz.
 * - `B4`: candidate B at 4×, a 25-tap Blackman-windowed sinc (192 → 96 kHz),
 *   then the drive's 65 taps (96 → 48 kHz).
 * - `REF16`: the 16× reference, a 2 049-tap Kaiser-windowed sinc (β 11.2)
 *   at 24 kHz, 768 → 48 kHz.
 *
 * Every stage is a linear-phase FIR that computes only the samples it
 * keeps. `response.mjs` prints each one's passband, stopband and delay.
 */

/** The three-term Blackman window the drive's oversampler uses. */
export const blackman = (k, n) =>
  0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (n - 1));

/** The zeroth-order modified Bessel function, by its series. */
function besselI0(x) {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 64; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
}

/** A Kaiser window of shape `beta`. */
export const kaiser = (beta) => (k, n) => {
  const r = (2 * k) / (n - 1) - 1;
  return besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta);
};

/** A windowed-sinc lowpass, `cutoff` in cycles per input sample, unity at DC. */
export function windowedSinc(taps, cutoff, window) {
  const h = new Float64Array(taps);
  const mid = (taps - 1) / 2;
  let sum = 0;
  for (let k = 0; k < taps; k++) {
    const t = k - mid;
    const sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
    h[k] = sinc * window(k, taps);
    sum += h[k];
  }
  for (let k = 0; k < taps; k++) h[k] /= sum;
  return h;
}

/** The drive oversampler's FIR (`DRIVE_DSP.firLength`, `firCutoff`). */
export const DRIVE_FIR = windowedSinc(65, 0.235, blackman);
/** Candidate B at 4×'s first stage, 192 → 96 kHz. */
export const B4_FIRST = windowedSinc(25, 0.25, blackman);
/** The 16× reference's filter, 768 → 48 kHz. */
export const REF16_FIR = windowedSinc(2049, 24000 / 768000, kaiser(11.2));

/** Each oversampling's stages, each halving (or dividing by `factor`) the rate. */
export const DECIMATORS = {
  B2: [{ h: DRIVE_FIR, factor: 2 }],
  B4: [
    { h: B4_FIRST, factor: 2 },
    { h: DRIVE_FIR, factor: 2 },
  ],
  REF16: [{ h: REF16_FIR, factor: 16 }],
};

/** A chain's delay in output samples: each stage's (taps − 1) / 2 at its input rate. */
export function chainDelay(stages) {
  let delay = 0;
  let rate = stages.reduce((r, s) => r * s.factor, 1);
  for (const { h, factor } of stages) {
    delay += (h.length - 1) / 2 / rate;
    rate /= factor;
  }
  return delay;
}

/**
 * One stage over a whole signal, zero phase: y[m] = Σ h[k] x[m·factor + k − (taps − 1) / 2],
 * the signal taken as 0 before its start (a note from silence), so y[m] is the
 * input's instant m·factor.
 */
function stage(x, { h, factor }) {
  const half = (h.length - 1) / 2;
  const out = new Float64Array(Math.floor((x.length - 1 - half) / factor) + 1);
  for (let m = 0; m < out.length; m++) {
    let acc = 0;
    const at = m * factor - half;
    for (let k = Math.max(0, -at); k < h.length; k++) acc += h[k] * x[at + k];
    out[m] = acc;
  }
  return out;
}

/** `x` through every stage, aligned: the output's sample m is the input's instant m (in output samples). */
export function decimate(x, stages) {
  let y = x;
  for (const s of stages) y = stage(y, s);
  return y;
}

/**
 * A streaming decimator for the bench: `push` takes `factor` input samples
 * and returns one output sample, from a doubled ring buffer so the dot
 * product never wraps.
 */
export class StreamDecimator {
  constructor({ h, factor }) {
    this.h = h;
    this.factor = factor;
    this.n = h.length;
    this.buf = new Float64Array(2 * h.length);
    this.at = 0;
  }
  /** `x[from .. from + factor)` in; the filtered sample out. */
  push(x, from) {
    const n = this.n;
    const buf = this.buf;
    for (let j = 0; j < this.factor; j++) {
      const v = x[from + j];
      buf[this.at] = v;
      buf[this.at + n] = v;
      if (++this.at === n) this.at = 0;
    }
    const h = this.h;
    let acc = 0;
    for (let k = 0; k < n; k++) acc += h[k] * buf[this.at + k];
    return acc;
  }
}

/** |H(f)| of `h` at `f` Hz for a filter at `rate` Hz. */
export function magnitude(h, f, rate) {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI * f) / rate;
  for (let k = 0; k < h.length; k++) {
    re += h[k] * Math.cos(w * k);
    im -= h[k] * Math.sin(w * k);
  }
  return Math.hypot(re, im);
}

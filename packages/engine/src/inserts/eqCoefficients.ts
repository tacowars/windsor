/**
 * The Parametric EQ's one coefficient module (windsor#198): it designs every
 * band's sections (the forms and their provenance are in
 * `eqSectionDesign.ts`) and computes the digital magnitude response from
 * those same coefficients, so the curve the console draws is the curve the
 * worklet (`worklet/eq/`, which imports this module) plays.
 *
 * Invariants: coefficients are normalised (a0 = 1) as b0, b1, b2, a1, a2 per
 * section (`EQ_SECTION`); `designEqBand` allocates nothing and passes no
 * double across a call, so the worklet can run it every refresh while a band
 * glides; `eqResponseDb` allocates nothing after the module loads. Pinned by
 * `eqCoefficients.test.ts`.
 */
import type { EqBandDesign } from './eqAnalog';
import {
  EQ_BAND_COUNT,
  EQ_BOUNDS,
  EQ_CUT_SECTION_Q,
  EQ_DSP,
  EQ_FIRST_ORDER_SLOPE,
  EQ_FLAT_Q,
  EQ_MATH as M,
  EQ_SECTION as X,
  EQ_TYPE_ID as T,
} from './eqConstants';
import { bell, identity, notch, pass1, pass2, setPhi, shelf, store, v } from './eqSectionDesign';
import type { EqSpec } from './eqSpec';

const TAU = 2 * Math.PI;
const PER = EQ_DSP.coefficientsPerSection;

function cut(highpass: boolean, slope: number, out: Float64Array, at: number): number {
  if (slope === EQ_FIRST_ORDER_SLOPE) {
    pass1(highpass);
    store(out, at);
    return 1;
  }
  const qs = EQ_CUT_SECTION_Q[slope as keyof typeof EQ_CUT_SECTION_Q];
  const last = qs.length - 1;
  for (let i = 0; i <= last; i++) {
    // The last (highest) section carries the band's Q over √½ (see `EQ_CUT_SECTION_Q`).
    v.pq = i === last ? v.q * (qs[i]! / EQ_FLAT_Q) : qs[i]!;
    pass2(highpass);
    store(out, at + i * PER);
  }
  return qs.length;
}

/**
 * Write `band`'s sections into `out` from `offset` (five coefficients each)
 * and return how many. The frequency is held between the range's floor and
 * `EQ_DSP.maxFrequencyRatio` of `sampleRate`; `band.gain` is the heard gain
 * (see `eqBandGain`), and a bell or shelf at exactly 0 dB is one identity section.
 */
export function designEqBand(
  band: EqBandDesign,
  sampleRate: number,
  out: Float64Array,
  offset = 0,
): number {
  const freq = Math.min(
    Math.max(band.freq, EQ_BOUNDS.freq[0]),
    sampleRate * EQ_DSP.maxFrequencyRatio,
  );
  v.w0 = (TAU * freq) / sampleRate;
  v.q = Math.min(Math.max(band.q, EQ_BOUNDS.q[0]), EQ_BOUNDS.q[1]);
  v.gain = band.gain;
  const type = band.type;
  if (type === T.lowcut || type === T.highcut)
    return cut(type === T.lowcut, band.slope, out, offset);
  if (type === T.notch) notch();
  else if (band.gain === 0) identity();
  else if (type === T.bell) bell();
  else shelf(type === T.lowshelf);
  store(out, offset);
  return 1;
}

/** The gain a band is heard at: its gain times scale for a bell or shelf, 0 for the others. */
export function eqBandGain(type: number, gain: number, scale: number): number {
  return type === T.bell || type === T.lowshelf || type === T.highshelf ? gain * scale : 0;
}

/** Section `at`'s power |H(e^jω)|² at the current basis, in Vicanek's well-conditioned form. */
function sectionPower(coeffs: Float64Array, at: number): number {
  const b0 = coeffs[at + X.b0]!;
  const b1 = coeffs[at + X.b1]!;
  const b2 = coeffs[at + X.b2]!;
  const a1 = coeffs[at + X.a1]!;
  const a2 = coeffs[at + X.a2]!;
  const n0 = b0 + b1 + b2;
  const n1 = b0 - b1 + b2;
  const d0 = 1 + a1 + a2;
  const d1 = 1 - a1 + a2;
  const top = n0 * n0 * v.p0 + n1 * n1 * v.p1 - M.four * b0 * b2 * v.p2;
  const bottom = d0 * d0 * v.p0 + d1 * d1 * v.p1 - M.four * a2 * v.p2;
  return top / bottom;
}

/** The dB response of `count` sections from `offset` at `frequency`. */
export function sectionsDb(
  coeffs: Float64Array,
  count: number,
  frequency: number,
  sampleRate: number,
  offset = 0,
): number {
  v.w = (TAU * frequency) / sampleRate;
  setPhi();
  let db = 0;
  for (let i = 0; i < count; i++) {
    const power = sectionPower(coeffs, offset + i * PER);
    db += M.powerDbPerDecade * Math.log10(Math.max(M.powerFloor, power));
  }
  return db;
}

const BAND_STRIDE = EQ_DSP.maxSections * PER;
const scratch = new Float64Array(EQ_BAND_COUNT * BAND_STRIDE);
const counts = new Uint8Array(EQ_BAND_COUNT);
const design: EqBandDesign = { type: 0, slope: 0, freq: 0, gain: 0, q: 0 };

/**
 * Fill `out` with the EQ's digital response in dB at each of `frequencies`
 * (Hz) at `sampleRate`, from the coefficients the worklet runs once every
 * glide has settled: every band that is on, times scale, plus output. A
 * disabled EQ is flat. Allocates nothing; returns `out`.
 */
export function eqResponseDb(
  spec: EqSpec,
  frequencies: ArrayLike<number>,
  sampleRate: number,
  out: Float64Array,
): Float64Array {
  const bands = spec.enabled ? Math.min(spec.bands.length, EQ_BAND_COUNT) : 0;
  for (let b = 0; b < bands; b++) {
    const band = spec.bands[b]!;
    design.type = T[band.type];
    design.slope = band.slope;
    design.freq = band.freq;
    design.gain = eqBandGain(design.type, band.gain, spec.scale);
    design.q = band.q;
    counts[b] = band.on ? designEqBand(design, sampleRate, scratch, b * BAND_STRIDE) : 0;
  }
  for (let i = 0; i < frequencies.length; i++) {
    let db = spec.enabled ? spec.output : 0;
    for (let b = 0; b < bands; b++)
      db += sectionsDb(scratch, counts[b]!, frequencies[i]!, sampleRate, b * BAND_STRIDE);
    out[i] = db;
  }
  return out;
}

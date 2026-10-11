/**
 * bloom's tone on the summed layer (`BLOOM_GENERATOR`), one segment at a time
 * in place on the synthesis's `left`/`right`:
 *
 * - The fixed filter: a linear-phase FIR (`toneHalfTaps` a side at 48 kHz,
 *   scaled with the rate) fitted by least squares, up to `nyquistShare` of the
 *   rate or 24 kHz, to the target roll-off 1/|1 + j·f/rolloffHz| times the
 *   correction that turns the bands' digital darkening poles
 *   (`bloomSynthMath.ts`) into the analog pole they stand for (learnt at a
 *   corner of `toneReferenceHz`; the error's shape hardly moves with the
 *   corner). Its delay is its half length, 6 samples at 48 kHz.
 * - Bright's tilt, (f / `tiltPivotHz`)^β: first-order shelves every
 *   `tiltSpacing` octaves from `tiltLowHz`, by the bilinear transform, each
 *   with its lower corner prewarped and a step of exactly 2^(|β|·spacing)
 *   (a zero then a pole; the pole first for a cut), so the steps sum to the
 *   law: within 0.6 dB of it from 40 Hz to 18 kHz at ±6 dB/oct. Scaled to 1
 *   at the pivot. Off (and skipped) at β = 0. With the generator's
 *   (pivot / fundamental)^β per band, every band's partial k moves by k^β.
 *
 * No transcendental `Math` on the sample path, and the tilt's coefficients
 * are built in place when Bright moves; no double crosses a call; every
 * double field is born NaN.
 */
import { BLOOM_GENERATOR as G } from '../../inserts/bloomGeneratorConstants';
import { cosine, exp2, sine } from '../../inserts/tapePortableMath';
import type { BloomGenerator } from './bloomGenerator';
import { exp2InPlace } from '../fm/portablePowers';
import { bloomDarkeningInPlace } from './bloomSynthMath';

/** `bloomDarkeningInPlace`'s slots: its four inputs and two working. */
const BLOOM_TONE_SCRATCH = 6;
/** The least-squares grid's points. */
const BLOOM_TONE_GRID = 1024;

class BloomTone {
  rate: number;
  /** Half the symmetric taps (the centre last); each side's doubled ring. */
  taps: Float64Array;
  ringLeft: Float64Array;
  ringRight: Float64Array;
  length: number;
  at: number;
  /** The tilt: its exponent, the section count, b0, b1, a1 per section, and each side's states. */
  beta: number;
  sections: number;
  /** Each section's lower corner, prewarped: tan(π·f/rate). */
  lowTan: Float64Array;
  b0: Float64Array;
  b1: Float64Array;
  a1: Float64Array;
  inLeft: Float64Array;
  outLeft: Float64Array;
  inRight: Float64Array;
  outRight: Float64Array;
  pivotCos: number;
  scratch: Float64Array;
  /** The last segment was mono: the right side's state is the left's, copied in when it leaves. */
  wasMono: boolean;

  constructor(rate: number) {
    this.rate = this.beta = this.pivotCos = NaN;
    this.rate = rate;
    const half = Math.max(2, Math.round((G.toneHalfTaps * rate) / G.toneTapsRate));
    this.length = 2 * half + 1;
    this.taps = bloomToneTaps(rate, half);
    this.ringLeft = new Float64Array(2 * this.length);
    this.ringRight = new Float64Array(2 * this.length);
    this.at = 0;
    const top = G.nyquistShare * rate;
    const corners: number[] = [];
    for (let f = G.tiltLowHz; f < top; f *= exp2(G.tiltSpacing)) corners.push(f);
    this.sections = corners.length;
    this.lowTan = Float64Array.from(
      corners,
      (f) => sine((Math.PI * f) / rate) / cosine((Math.PI * f) / rate),
    );
    this.b0 = new Float64Array(this.sections);
    this.b1 = new Float64Array(this.sections);
    this.a1 = new Float64Array(this.sections);
    this.inLeft = new Float64Array(this.sections);
    this.outLeft = new Float64Array(this.sections);
    this.inRight = new Float64Array(this.sections);
    this.outRight = new Float64Array(this.sections);
    this.pivotCos = cosine((2 * Math.PI * G.tiltPivotHz) / rate);
    this.scratch = new Float64Array(2);
    this.beta = 0;
    this.wasMono = true;
    this.clear();
  }

  clear(): void {
    this.ringLeft.fill(0);
    this.ringRight.fill(0);
    this.at = 0;
    this.inLeft.fill(0);
    this.outLeft.fill(0);
    this.inRight.fill(0);
    this.outRight.fill(0);
  }

  /** The tilt's sections for the generator's β (Bright as log2 of amplitude an octave), when it moved. */
  tilt(generator: BloomGenerator): void {
    const beta = generator.beta;
    if (beta === this.beta) return;
    this.beta = beta;
    if (beta === 0) return;
    const scratch = this.scratch;
    // Each section a shelf of exactly 2^(|β|·spacing) between its warped corners, so the steps sum to the law.
    scratch[0] = (beta < 0 ? -beta : beta) * G.tiltSpacing;
    exp2InPlace(scratch, 0);
    const span = scratch[0];
    let gain = 1;
    for (let i = 0; i < this.sections; i++) {
      const low = this.lowTan[i],
        high = low * span;
      const wz = beta > 0 ? low : high,
        wp = beta > 0 ? high : low;
      const k = wp / wz / (1 + wp);
      const b0 = k * (1 + wz),
        b1 = k * (wz - 1),
        a1 = (wp - 1) / (1 + wp);
      this.b0[i] = b0;
      this.b1[i] = b1;
      this.a1[i] = a1;
      // |H| at the pivot, for the scale.
      const c = this.pivotCos;
      gain *= Math.sqrt((b0 * b0 + b1 * b1 + 2 * b0 * b1 * c) / (1 + a1 * a1 + 2 * a1 * c));
    }
    this.b0[0] /= gain;
    this.b1[0] /= gain;
  }

  /** The segment in `left` (and `right` unless `mono`, which then copies left) through the fixed filter and the tilt. */
  process(left: Float64Array, right: Float64Array, mono: boolean): void {
    const length = this.length,
      half = this.taps.length - 1,
      taps = this.taps,
      ringLeft = this.ringLeft,
      ringRight = this.ringRight,
      tilting = this.beta !== 0;
    if (this.wasMono && !mono) {
      ringRight.set(ringLeft);
      this.inRight.set(this.inLeft);
      this.outRight.set(this.outLeft);
    }
    this.wasMono = mono;
    for (let s = 0; s < left.length; s++) {
      let at = this.at - 1;
      if (at < 0) at = length - 1;
      this.at = at;
      const l = left[s];
      ringLeft[at] = l;
      ringLeft[at + length] = l;
      let sumLeft = taps[half] * ringLeft[at + half];
      for (let k = 0; k < half; k++)
        sumLeft += taps[k] * (ringLeft[at + k] + ringLeft[at + length - 1 - k]);
      left[s] = sumLeft;
      if (!mono) {
        const r = right[s];
        ringRight[at] = r;
        ringRight[at + length] = r;
        let sumRight = taps[half] * ringRight[at + half];
        for (let k = 0; k < half; k++)
          sumRight += taps[k] * (ringRight[at + k] + ringRight[at + length - 1 - k]);
        right[s] = sumRight;
      }
    }
    if (tilting) {
      this.shelve(left, this.inLeft, this.outLeft);
      if (!mono) this.shelve(right, this.inRight, this.outRight);
    }
    if (mono) right.set(left);
  }

  /** One side through the tilt's sections, in place. */
  shelve(data: Float64Array, held: Float64Array, out: Float64Array): void {
    const b0 = this.b0,
      b1 = this.b1,
      a1 = this.a1;
    for (let s = 0; s < data.length; s++) {
      let x = data[s];
      for (let i = 0; i < this.sections; i++) {
        const y = b0[i] * x + b1[i] * held[i] - a1[i] * out[i];
        held[i] = x;
        out[i] = y;
        x = y;
      }
      data[s] = x;
    }
  }
}

/**
 * The fixed filter's taps from the centre out (`taps[half]` the centre): the
 * least-squares fit on a uniform grid. Constructor only.
 */
function bloomToneTaps(rate: number, half: number): Float64Array {
  const top = Math.min(G.harmonicLimitHz, G.nyquistShare * rate);
  const size = half + 1;
  const normal = Array.from({ length: size }, () => new Float64Array(size + 1));
  const basis = new Float64Array(size);
  const scratch = new Float64Array(BLOOM_TONE_SCRATCH);
  for (let g = 0; g <= BLOOM_TONE_GRID; g++) {
    const f = (top * g) / BLOOM_TONE_GRID,
      w = (2 * Math.PI * f) / rate;
    // The digital darkening pole at the reference corner, normalised at DC, against the analog one.
    scratch[0] = G.toneReferenceHz;
    scratch[1] = rate;
    scratch[2] = 1;
    bloomDarkeningInPlace(scratch, 0);
    const a = scratch[0],
      b = scratch[1],
      c = scratch[2],
      cw = cosine(w);
    const digital = (c * Math.sqrt(1 + b * b + 2 * b * cw)) / Math.sqrt(1 + a * a - 2 * a * cw);
    const toReference = f / G.toneReferenceHz,
      toRolloff = f / G.rolloffHz;
    const analog = 1 / Math.sqrt(1 + toReference * toReference);
    const want = analog / digital / Math.sqrt(1 + toRolloff * toRolloff);
    // H(ω) = h_c + 2 Σ_m h_m cos(mω), m = 1 … half (the taps from the centre).
    for (let m = 0; m < size; m++) basis[m] = m === 0 ? 1 : 2 * cosine(m * w);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) normal[i]![j] += basis[i]! * basis[j]!;
      normal[i]![size] += basis[i]! * want;
    }
  }
  for (let i = 0; i < size; i++) {
    let pivot = i;
    for (let r = i + 1; r < size; r++)
      if (Math.abs(normal[r]![i]!) > Math.abs(normal[pivot]![i]!)) pivot = r;
    [normal[i], normal[pivot]] = [normal[pivot]!, normal[i]!];
    for (let r = 0; r < size; r++) {
      if (r === i) continue;
      const factor = normal[r]![i]! / normal[i]![i]!;
      for (let col = i; col <= size; col++) normal[r]![col] -= factor * normal[i]![col]!;
    }
  }
  // The solved h_m, m = 0 (centre) … half, laid out centre last.
  const taps = new Float64Array(size);
  for (let m = 0; m < size; m++) taps[half - m] = normal[m]![size]! / normal[m]![m]!;
  return taps;
}

export { BloomTone };

/**
 * The magnetic Tape core's oversampler (windsor#219 decision 8):
 * `worklet/tape/tapeOversample.ts`'s FIR pair against #207's span-48 figures
 * (`docs/log/2026-09-30-tape-resampler.md`), its exact delay, its derivative
 * pair and its symmetric decimator, each run through the class itself with
 * the identity core. Every check is a function that returns what it
 * measured, so the negative controls can break the taps on purpose and see
 * the same check fail. The allocation check is in `tapeMagneticGolden.test.ts`,
 * beside the render it measures.
 */
import { describe, expect, it } from 'vitest';
import { TapeOversampler, kernel } from '../worklet/tape/tapeOversample';
import { TAPE_MAGNETIC } from './tapeMagneticConstants';

const RATE = 48000;
const SPAN = 48;
const FACTORS = TAPE_MAGNETIC.factors;
/** #207's figures: ±0.1 dB to 0.40 fs end to end, images and aliases at or below -60 dBc. */
const PASSBAND_DB = 0.1;
const REJECTION_DBC = -60;

const db = (x: number) => 20 * Math.log10(x);

/** The amplitude of `signal`'s component at `cycles` cycles over its whole length (coherent). */
function amplitude(signal: ArrayLike<number>, cycles: number): number {
  let re = 0;
  let im = 0;
  for (let n = 0; n < signal.length; n++) {
    const phase = (2 * Math.PI * cycles * n) / signal.length;
    re += signal[n]! * Math.cos(phase);
    im += signal[n]! * Math.sin(phase);
  }
  return (2 * Math.hypot(re, im)) / signal.length;
}

/** Host-rate output and every stage point of the identity pair on `input`. */
function identityRun(
  factor: number,
  input: (n: number) => number,
  frames: number,
  scaleSlopes = 1,
) {
  const o = new TapeOversampler(RATE, factor, true);
  for (let i = 0; i < o.slopeTaps.length; i++) o.slopeTaps[i] = o.slopeTaps[i]! * scaleSlopes;
  const phases = 2 * factor;
  const output = new Float64Array(frames);
  const field = new Float64Array(frames * phases);
  const slope = new Float64Array(frames * phases);
  for (let n = 0; n < frames; n++) {
    output[n] = o.process(input(n));
    for (let q = 1; q <= phases; q++) {
      field[n * phases + q - 1] = o.stages[2 * q]!;
      slope[n * phases + q - 1] = o.stages[2 * q + 1]!;
    }
  }
  return { o, output, field, slope };
}

/** The worst end-to-end deviation from unity, in dB, over tones 0.01 … 0.40 fs. */
function passbandDeviation(factor: number): number {
  const window = 400;
  const settle = 2 * SPAN + 64;
  let worst = 0;
  for (let k = 4; k <= 160; k += 4) {
    const { output } = identityRun(
      factor,
      (n) => Math.cos((2 * Math.PI * k * n) / window),
      settle + window,
    );
    worst = Math.max(worst, Math.abs(db(amplitude(output.subarray(settle), k))));
  }
  return worst;
}

/** The worst image, in dBc, of host tones 0.05 … 0.45 fs in the oversampled field. */
function worstImage(factor: number): number {
  const window = 400;
  const settle = SPAN + 16;
  let worst = -Infinity;
  for (const k of [20, 40, 80, 120, 160, 180]) {
    const { field } = identityRun(
      factor,
      (n) => Math.cos((2 * Math.PI * k * n) / window),
      settle + window,
    );
    const ends = Float64Array.from({ length: window * factor }, (_, i) => {
      return field[settle * 2 * factor + 2 * i + 1]!;
    });
    const tone = amplitude(ends, k);
    for (let m = 1; m < factor; m++) {
      for (const image of [m * window - k, m * window + k]) {
        if (image < (window * factor) / 2)
          worst = Math.max(worst, db(amplitude(ends, image) / tone));
      }
    }
  }
  return worst;
}

/** The worst alias, in dBc: the decimator's gain at every in-band image of the same tones. */
function worstAlias(taps: Float64Array, factor: number): number {
  const gain = (nu: number) => {
    let re = 0;
    let im = 0;
    for (let j = 0; j < taps.length; j++) {
      re += taps[j]! * Math.cos(2 * Math.PI * nu * j);
      im -= taps[j]! * Math.sin(2 * Math.PI * nu * j);
    }
    return Math.hypot(re, im);
  };
  let worst = -Infinity;
  for (const f of [0.05, 0.1, 0.2, 0.3, 0.4, 0.45]) {
    for (let m = 1; m < factor; m++) {
      for (const image of [m - f, m + f]) {
        if (image < factor / 2)
          worst = Math.max(worst, db(gain(image / factor) / gain(f / factor)));
      }
    }
  }
  return worst;
}

/**
 * The field the pair reconstructs, as a function of continuous time: the
 * same kernel (`kernel`, scaled as the class scales it) summed over the host
 * input. The class evaluates it only at its stage times; the test anywhere.
 */
function continuousField(factor: number, input: Float64Array): (t: number) => number {
  const order = SPAN * factor;
  let sum = 0;
  for (let j = 0; j <= order; j++) sum += kernel((j - order / 2) / factor, TAPE_MAGNETIC);
  const scale = factor / sum;
  return (t) => {
    let h = 0;
    const first = Math.max(0, Math.ceil(t - SPAN / 2));
    const last = Math.min(input.length - 1, Math.floor(t + SPAN / 2));
    for (let i = first; i <= last; i++) h += input[i]! * kernel(t - i, TAPE_MAGNETIC) * scale;
    return h;
  };
}

/**
 * On a 1 kHz sine, the worst difference between the class's stage points
 * and the continuous field (H), and between its dH and a fourth-order central
 * difference of that field at a spacing of 1e-3 host samples (dH), each
 * relative to its peak. Stage q of host step n is at n − span/2 − 1 + q / (2 factor).
 */
function derivativeError(factor: number, scaleSlopes = 1) {
  const frames = 3 * SPAN;
  const input = Float64Array.from({ length: frames }, (_, n) =>
    Math.sin((2 * Math.PI * 1000 * n) / RATE + 0.3),
  );
  const { field, slope } = identityRun(factor, (n) => input[n]!, frames, scaleSlopes);
  const at = continuousField(factor, input);
  const phases = 2 * factor;
  const h = 1e-3;
  const errors = { field: 0, slope: 0, fieldPeak: 0, slopePeak: 0 };
  for (let n = SPAN + SPAN / 2; n < frames; n++) {
    for (let q = 1; q <= phases; q++) {
      const t = n - SPAN / 2 - 1 + q / phases;
      const p = n * phases + q - 1;
      const difference =
        ((-at(t + 2 * h) + 8 * at(t + h) - 8 * at(t - h) + at(t - 2 * h)) / (12 * h)) * RATE;
      errors.field = Math.max(errors.field, Math.abs(field[p]! - at(t)));
      errors.slope = Math.max(errors.slope, Math.abs(slope[p]! - difference));
      errors.fieldPeak = Math.max(errors.fieldPeak, Math.abs(field[p]!));
      errors.slopePeak = Math.max(errors.slopePeak, Math.abs(slope[p]!));
    }
  }
  return { field: errors.field / errors.fieldPeak, slope: errors.slope / errors.slopePeak };
}

describe('the FIR pair', () => {
  it.each(FACTORS)(
    '%ix: taps are exactly symmetric, sum to 1 and are shared by both FIRs',
    (factor) => {
      const o = new TapeOversampler(RATE, factor);
      const taps = o.decimator;
      expect(taps.length).toBe(SPAN * factor + 1);
      for (let j = 0; j < taps.length; j++) expect(taps[j]).toBe(taps[taps.length - 1 - j]);
      expect(Math.abs(taps.reduce((a, b) => a + b, 0) - 1)).toBeLessThanOrEqual(1e-15);
      // Phase 2r of the interpolator (an oversampled integer time) is factor × the decimator's taps.
      for (let r = 1; r <= factor; r++) {
        for (let n = 0; n < SPAN; n++) {
          const j = factor * (SPAN - 1 - n) + r;
          expect(o.fieldTaps[(2 * r - 1) * SPAN + n]).toBe(factor * taps[j]!);
        }
      }
    },
  );

  it.each(FACTORS)('%ix: the identity pair delays an impulse by exactly 48 samples', (factor) => {
    const { o, output } = identityRun(factor, (n) => (n === 0 ? 1 : 0), 2 * SPAN + 1);
    expect(o.latency).toBe(SPAN);
    const peak = output.indexOf(Math.max(...output));
    expect(peak).toBe(SPAN);
    for (let d = 1; d <= SPAN; d++) {
      expect(Math.abs(output[SPAN + d]! - output[SPAN - d]!)).toBeLessThanOrEqual(1e-15);
    }
    expect(Math.abs(output.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-12);
  });

  it.each(FACTORS)("%ix: meets #207's span-48 figures", (factor) => {
    const o = new TapeOversampler(RATE, factor);
    expect(passbandDeviation(factor)).toBeLessThanOrEqual(PASSBAND_DB);
    expect(worstImage(factor)).toBeLessThanOrEqual(REJECTION_DBC);
    expect(worstAlias(o.decimator, factor)).toBeLessThanOrEqual(REJECTION_DBC);
  });

  it.each(FACTORS)('%ix: the symmetric decimator matches a direct dot product', (factor) => {
    const input = (n: number) =>
      0.7 * Math.sin(0.057 * n) + 0.2 * Math.sin(2.1 * n) + 0.1 * Math.cos(0.37 * n * n);
    const frames = 1000;
    const { o, output, field } = identityRun(factor, input, frames);
    const ends = Float64Array.from({ length: frames * factor }, (_, i) => field[2 * i + 1]!);
    const taps = o.decimator;
    let peak = 0;
    let worst = 0;
    for (let n = 0; n < frames; n++) {
      const newest = (n + 1) * factor - 1;
      let direct = 0;
      for (let j = 0; j < taps.length && newest - j >= 0; j++)
        direct += taps[j]! * ends[newest - j]!;
      worst = Math.max(worst, Math.abs(direct - output[n]!));
      peak = Math.max(peak, Math.abs(ends[newest]!));
    }
    expect(worst).toBeLessThanOrEqual(4e-15 * peak);
  });
});

describe('the derivative pair', () => {
  it.each(FACTORS)('%ix: H is the kernel sum at the stage times, dH its derivative', (factor) => {
    const error = derivativeError(factor);
    expect(error.field).toBeLessThanOrEqual(1e-12);
    expect(error.slope).toBeLessThanOrEqual(1e-6);
  });

  it.each(FACTORS)('%ix: fails when dH is scaled per oversampled sample', (factor) => {
    expect(derivativeError(factor, 1 / factor).slope).toBeGreaterThan(1e-6);
  });
});

describe('the negative controls', () => {
  it('an interpolator whose stage times run a stage late fails the delay symmetry', () => {
    const o = new TapeOversampler(RATE, 2, true);
    const phases = 4;
    const rows = Float64Array.from(o.fieldTaps);
    for (let q = 0; q < phases; q++) {
      for (let n = 0; n < SPAN; n++) {
        const late = q + 1 < phases ? rows[(q + 1) * SPAN + n]! : n >= 1 ? rows[n - 1]! : 0;
        o.fieldTaps[q * SPAN + n] = late;
      }
    }
    const output = Float64Array.from({ length: 2 * SPAN + 1 }, (_, n) =>
      o.process(n === 0 ? 1 : 0),
    );
    let worst = 0;
    for (let d = 1; d <= SPAN; d++) {
      worst = Math.max(worst, Math.abs(output[SPAN + d]! - output[SPAN - d]!));
    }
    expect(worst).toBeGreaterThan(1e-3);
  });

  it('a pair without the window fails the alias figure', () => {
    const plain = { ...TAPE_MAGNETIC, blackman: [1, 0, 0] };
    const o = new TapeOversampler(RATE, 2, true, plain);
    expect(worstAlias(o.decimator, 2)).toBeGreaterThan(REJECTION_DBC);
  });
});

describe('the per-sample path', () => {
  it('never calls configure', () => {
    const o = new TapeOversampler(RATE, 4);
    o.core.configure = () => {
      throw new Error('configure on the per-sample path');
    };
    const input = Float32Array.from({ length: 512 }, (_, n) => 3 * Math.sin(n / 7));
    const output = new Float32Array(512);
    expect(() => {
      o.render(input, output, input.length);
      o.process(0.5);
    }).not.toThrow();
  });
});

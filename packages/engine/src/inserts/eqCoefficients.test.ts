import { describe, expect, it } from 'vitest';
import { ACCURACY_GRID, worstError } from '../__fixtures__/eqAccuracy';
import { analogBandPower } from './eqAnalog';
import {
  EQ_BAND_TYPES,
  EQ_BOUNDS,
  EQ_CUT_SECTION_Q,
  EQ_DSP,
  EQ_SLOPES,
  EQ_TYPE_ID as T,
} from './eqConstants';
import { designEqBand, eqBandGain, eqResponseDb, sectionsDb } from './eqCoefficients';
import { DEFAULT_EQ } from './eqSpec';
import type { EqBand, EqSpec } from './eqSpec';

const RATES = [44100, 48000, 96000];
const coeffs = new Float64Array(EQ_DSP.maxSections * EQ_DSP.coefficientsPerSection);
const design = (type: number, freq: number, gain: number, q: number, slope = 12) => ({
  type,
  slope,
  freq,
  gain,
  q,
});
const bandDb = (band: ReturnType<typeof design>, f: number, rate: number): number =>
  sectionsDb(coeffs, designEqBand(band, rate, coeffs), f, rate);

describe('the cut tables', () => {
  it('are the Butterworth Qs, lowest first', () => {
    for (const n of [4, 8] as const) {
      const qs = EQ_CUT_SECTION_Q[n === 4 ? 24 : 48];
      qs.forEach((q, i) =>
        expect(q).toBeCloseTo(1 / (2 * Math.cos(((2 * i + 1) * Math.PI) / (2 * n))), 14),
      );
    }
  });
});

describe('stability', () => {
  const corners = RATES.flatMap((rate) =>
    EQ_BAND_TYPES.flatMap((type) =>
      EQ_SLOPES.flatMap((slope) =>
        [EQ_BOUNDS.freq[0], 20, 1000, 15000, EQ_BOUNDS.freq[1]].flatMap((freq) =>
          EQ_BOUNDS.q.flatMap((q) =>
            // ±48 dB: the widest a gain reaches, at scale 200 %.
            [-48, -24, -0.001, 0, 0.001, 24, 48].map((gain) => ({
              rate,
              band: design(T[type], freq, gain, q, slope),
            })),
          ),
        ),
      ),
    ),
  );

  it('keeps every section inside the unit circle at the corners of every range', () => {
    let checked = 0;
    for (const { rate, band } of corners) {
      const count = designEqBand(band, rate, coeffs);
      for (let i = 0; i < count; i++) {
        const [b0, b1, b2, a1, a2] = coeffs.subarray(i * 5, i * 5 + 5);
        expect([b0, b1, b2, a1, a2].every(Number.isFinite)).toBe(true);
        expect(Math.abs(a2!)).toBeLessThan(1);
        expect(Math.abs(a1!)).toBeLessThan(1 + a2!);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });
});

describe('the bell', () => {
  it('reaches its set gain at its centre within 0.01 dB from 20 Hz to 0.45 × the sample rate', () => {
    let worst = 0;
    for (const rate of RATES)
      for (let i = 0; i <= 120; i++) {
        const freq = 20 * Math.pow((0.45 * rate) / 20, i / 120);
        for (const q of [0.1, 0.3, 0.71, 1, 2, 4, 8, 18])
          for (const gain of [-24, -12, -3, -0.5, 0.5, 3, 12, 24]) {
            worst = Math.max(
              worst,
              Math.abs(bandDb(design(T.bell, freq, gain, q), freq, rate) - gain),
            );
          }
      }
    expect(worst).toBeLessThan(0.01);
  });

  it('is exactly flat at 0 dB, and a notch or cut ignores gain', () => {
    expect(bandDb(design(T.bell, 1000, 0, 4), 900, 48000)).toBe(0);
    expect(bandDb(design(T.lowshelf, 1000, 0, 4), 300, 48000)).toBe(0);
    expect(eqBandGain(T.bell, 6, 1.5)).toBe(9);
    expect(eqBandGain(T.notch, 6, 1.5)).toBe(0);
    expect(eqBandGain(T.highcut, 6, 1.5)).toBe(0);
  });
});

describe('the cuts', () => {
  const corners = { lowcut: [30, 100, 1000, 2500], highcut: [100, 1000, 2500] };
  it('are −3 dB at the corner at Q 0.71 and fall at their slope two octaves past it', () => {
    for (const rate of [44100, 48000])
      for (const type of ['lowcut', 'highcut'] as const)
        for (const freq of corners[type])
          for (const slope of EQ_SLOPES) {
            const band = design(T[type], freq, 0, 0.71, slope);
            expect(bandDb(band, freq, rate), `${type} ${freq} ${slope}`).toBeCloseTo(-3.01, 1);
            // The fall over the octave centred two octaves past the corner.
            const dir = type === 'lowcut' ? 0.5 : 2;
            const fall =
              bandDb(band, freq * dir ** 1.5, rate) - bandDb(band, freq * dir ** 2.5, rate);
            expect(Math.abs(fall - slope), `${type} ${freq} ${slope}`).toBeLessThan(1);
          }
  });
});

/**
 * The matched designs' worst error against the analog prototype from 20 Hz to
 * 16 kHz, over Q 0.7, 2, 8 and ±12 dB (cuts at 12 dB/oct), per centre: the
 * bounds found when the forms were chosen (research README), rounded up.
 */
const MATCHED_BOUNDS: Record<number, Record<string, readonly number[]>> = {
  44100: {
    lowcut: [0.01, 0.12, 0.36, 1.15, 3.19],
    lowshelf: [0.01, 0.21, 2.12, 0.27, 1.03],
    bell: [0.02, 0.39, 0.82, 0.5, 1.01],
    notch: [0.01, 0.13, 0.6, 1.67, 2.85],
    highshelf: [0.01, 0.21, 2.12, 0.27, 1.03],
    highcut: [0.01, 0.45, 0.35, 0.09, 0.25],
  },
  48000: {
    lowcut: [0.01, 0.08, 0.24, 0.75, 1.93],
    lowshelf: [0.01, 0.15, 1.34, 0.27, 0.6],
    bell: [0.02, 0.27, 0.6, 0.37, 0.71],
    notch: [0.01, 0.09, 0.4, 1.07, 1.76],
    highshelf: [0.01, 0.15, 1.34, 0.27, 0.6],
    highcut: [0.01, 0.28, 0.21, 0.06, 0.15],
  },
};

describe('accuracy against the analog prototype', () => {
  it.each(ACCURACY_GRID.rates)('holds the matched bounds at %i Hz', (rate) => {
    for (const type of EQ_BAND_TYPES)
      ACCURACY_GRID.centres.forEach((centre, i) => {
        const error = worstError(T[type], centre, rate, 'matched', 16000);
        expect(error, `${type} ${centre}`).toBeLessThanOrEqual(MATCHED_BOUNDS[rate]![type]![i]!);
      });
  });

  it('beats the bilinear form for every type from 5 kHz up', () => {
    for (const rate of ACCURACY_GRID.rates)
      for (const type of EQ_BAND_TYPES)
        for (const centre of [5000, 10000, 15000, 18000]) {
          const matched = worstError(T[type], centre, rate, 'matched', 16000);
          expect(matched).toBeLessThan(worstError(T[type], centre, rate, 'bilinear', 16000));
        }
  });

  it('follows the prototype closely where the two agree, far below Nyquist', () => {
    for (const type of EQ_BAND_TYPES) {
      const band = design(T[type], 200, 9, 2, 24);
      for (const f of [50, 100, 190, 400, 800])
        expect(bandDb(band, f, 48000)).toBeCloseTo(
          10 * Math.log10(analogBandPower(band, f / 200)),
          1,
        );
    }
  });
});

describe('eqResponseDb', () => {
  const frequencies = Float64Array.from({ length: 64 }, (_, i) => 10 * Math.pow(2200, i / 63));
  const bands = (edit: (band: EqBand, i: number) => Partial<EqBand>): EqBand[] =>
    DEFAULT_EQ.bands.map((band, i) => ({ ...band, ...edit(band, i) }));

  it('is exactly flat for a new EQ and for a disabled one, and adds output', () => {
    const out = new Float64Array(frequencies.length);
    expect(eqResponseDb(DEFAULT_EQ, frequencies, 48000, out)).toBe(out);
    expect([...out].every((db) => db === 0)).toBe(true);
    const busy: EqSpec = { ...DEFAULT_EQ, output: -4, bands: bands(() => ({ gain: 6, on: true })) };
    eqResponseDb({ ...busy, enabled: false }, frequencies, 48000, out);
    expect([...out].every((db) => db === 0)).toBe(true);
    eqResponseDb({ ...DEFAULT_EQ, output: -4 }, frequencies, 48000, out);
    expect([...out].every((db) => db === -4)).toBe(true);
  });

  it('is the sum of the bands that are on, with gain times scale', () => {
    const spec: EqSpec = {
      ...DEFAULT_EQ,
      scale: 0.5,
      output: 1,
      bands: bands((_, i) =>
        i === 2 ? { gain: 8, q: 3 } : i === 7 ? { on: true, slope: 24 } : {},
      ),
    };
    const out = new Float64Array(frequencies.length);
    eqResponseDb(spec, frequencies, 48000, out);
    frequencies.forEach((f, i) => {
      const bell = bandDb(design(T.bell, 250, 4, 3), f, 48000);
      const cut = bandDb(design(T.highcut, 18000, 0, Math.SQRT1_2, 24), f, 48000);
      expect(out[i]).toBeCloseTo(1 + bell + cut, 10);
    });
  });
});

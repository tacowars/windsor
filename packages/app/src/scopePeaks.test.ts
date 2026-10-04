import { describe, expect, it } from 'vitest';
import { createPeakPicker, peakLabel } from './scopePeaks';

const RATE = 48000;
const FFT = 8192;
const BIN_HZ = RATE / FFT;
const BINS = FFT / 2;
const MAX_HZ = 20000;
/** Where the fixture leaves the bins it does not compute: far under the floor. */
const QUIET_DB = -150;
/** How many bins either side of a partial the fixture computes. */
const REACH = 24;

/**
 * What the analyser's `getFloatFrequencyData` reads for a sum of steady
 * sines: a Blackman window (α = 0.16, the Web Audio spec's), the DFT over N,
 * in dB. Computed only near each partial, the rest left quiet.
 */
function spectrum(partials: readonly (readonly [number, number])[]): Float32Array {
  const x = new Float64Array(FFT);
  for (let n = 0; n < FFT; n++) {
    const w =
      0.42 - 0.5 * Math.cos((2 * Math.PI * n) / FFT) + 0.08 * Math.cos((4 * Math.PI * n) / FFT);
    let v = 0;
    for (const [hz, amp] of partials) v += amp * Math.sin((2 * Math.PI * hz * n) / RATE);
    x[n] = v * w;
  }
  const bins = new Float32Array(BINS).fill(QUIET_DB);
  for (const [hz] of partials) {
    const centre = Math.round(hz / BIN_HZ);
    for (let k = Math.max(0, centre - REACH); k <= Math.min(BINS - 1, centre + REACH); k++) {
      let re = 0;
      let im = 0;
      for (let n = 0; n < FFT; n++) {
        re += x[n]! * Math.cos((2 * Math.PI * k * n) / FFT);
        im -= x[n]! * Math.sin((2 * Math.PI * k * n) / FFT);
      }
      bins[k] = Math.max(QUIET_DB, 20 * Math.log10(Math.hypot(re, im) / FFT));
    }
  }
  return bins;
}

const pick = (bins: Float32Array): { n: number; hz: number[] } => {
  const picker = createPeakPicker();
  const n = picker.pick(bins, BIN_HZ, MAX_HZ);
  return { n, hz: Array.from(picker.hz.subarray(0, n)) };
};

describe('createPeakPicker', () => {
  it('reads a sine at A4 to within 1 Hz, and labels it A4', () => {
    const { n, hz } = pick(spectrum([[440, 0.5]]));
    expect(n).toBe(1);
    expect(Math.abs(hz[0]! - 440)).toBeLessThan(1);
    expect(peakLabel(hz[0]!)).toMatch(/^4[34]\d\.\d Hz A4$/);
  });

  it('reads a sine between bins as closely', () => {
    const { hz } = pick(spectrum([[195.9, 0.5]]));
    expect(Math.abs(hz[0]! - 195.9)).toBeLessThan(1);
  });

  it('takes the three loudest harmonics, loudest first', () => {
    const { n, hz } = pick(
      spectrum([110, 220, 330, 440, 550].map((f, i) => [f, 0.5 / (i + 1)] as const)),
    );
    expect(n).toBe(3);
    expect(hz.map(Math.round)).toEqual([110, 220, 330]);
  });

  it('counts a peak once across its neighbouring bins and shoulders', () => {
    const bins = new Float32Array(BINS).fill(-100);
    // A main lobe at bin 100 with a flat top, and a shoulder maximum two bins over.
    bins.set([-40, -24, -18, -18, -26, -30, -27, -45], 97);
    const { n, hz } = pick(bins);
    expect(n).toBe(1);
    expect(hz[0]! / BIN_HZ).toBeGreaterThan(99);
    expect(hz[0]! / BIN_HZ).toBeLessThan(100);
  });

  it('counts two sines a quarter-tone apart as one peak', () => {
    expect(
      pick(
        spectrum([
          [440, 0.5],
          [452.9, 0.3],
        ]),
      ).n,
    ).toBe(1);
  });

  it('labels nothing on a flat floor, above or below the threshold', () => {
    expect(pick(new Float32Array(BINS).fill(-100)).n).toBe(0);
    expect(pick(new Float32Array(BINS).fill(-20)).n).toBe(0);
  });

  it('labels nothing in silence, where every bin is −∞', () => {
    expect(pick(new Float32Array(BINS).fill(-Infinity)).n).toBe(0);
  });

  it('labels nothing quieter than the floor, nor outside the axis', () => {
    expect(pick(spectrum([[440, 0.0005]])).n).toBe(0);
    expect(pick(spectrum([[10, 0.5]])).n).toBe(0);
    expect(pick(spectrum([[22000, 0.5]])).n).toBe(0);
  });
});

describe('peakLabel', () => {
  it('reads the frequency to a tenth and the nearest note', () => {
    expect(peakLabel(195.94)).toBe('195.9 Hz G3');
    expect(peakLabel(32.7)).toBe('32.7 Hz C1');
    expect(peakLabel(4186)).toBe('4186.0 Hz C8');
  });
});

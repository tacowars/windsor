/**
 * The Parametric EQ's accuracy measurement (windsor#198): the error of a
 * band's digital response against its analog prototype, for the shipped
 * (matched) designs and for the prewarped bilinear (cookbook) designs they
 * were chosen over. `eqCoefficients.test.ts` pins the matched bounds, and
 * `docs/research/2026-09-30-parametric-eq/bench.mjs` bundles this file to
 * write the README's table.
 */
import type { EqBandDesign } from '../inserts/eqAnalog';
import { analogBandPower, cutSectionCount, cutSectionQ, shelfAmplitude } from '../inserts/eqAnalog';
import { EQ_BAND_TYPES, EQ_DSP, EQ_TYPE_ID as T } from '../inserts/eqConstants';
import { designEqBand, sectionsDb } from '../inserts/eqCoefficients';

export type EqForm = 'matched' | 'bilinear';

/** The grid the README's table and the pinned bounds cover. */
export const ACCURACY_GRID = {
  rates: [44100, 48000],
  centres: [1000, 5000, 10000, 15000, 18000],
  qs: [0.7, 2, 8],
  gains: [-12, 12],
  types: EQ_BAND_TYPES,
  /** Where the error is read: 401 log-spaced points from 20 Hz. */
  lowHz: 20,
  points: 401,
  /** Below this the prototype is a stopband or the notch's floor, not a level anyone hears. */
  floorDb: -30,
} as const;

type Section = [b: number[], a: number[]];

function write(out: Float64Array, at: number, [b, a]: Section): void {
  out[at] = b[0]! / a[0]!;
  out[at + 1] = b[1]! / a[0]!;
  out[at + 2] = b[2]! / a[0]!;
  out[at + 3] = a[1]! / a[0]!;
  out[at + 4] = a[2]! / a[0]!;
}

/** One cookbook (RBJ) section; `kind` a type id, or −1/−2 for a first-order low/highpass. */
function cookbook(kind: number, w0: number, gain: number, q: number): Section {
  const c = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const A = shelfAmplitude(gain);
  const k = 2 * Math.sqrt(A) * alpha;
  const t = Math.tan(w0 / 2);
  if (kind === -1)
    return [
      [t, t, 0],
      [1 + t, t - 1, 0],
    ];
  if (kind === -2)
    return [
      [1, -1, 0],
      [1 + t, t - 1, 0],
    ];
  if (kind === T.bell)
    return [
      [1 + alpha * A, -2 * c, 1 - alpha * A],
      [1 + alpha / A, -2 * c, 1 - alpha / A],
    ];
  if (kind === T.notch)
    return [
      [1, -2 * c, 1],
      [1 + alpha, -2 * c, 1 - alpha],
    ];
  if (kind === T.highcut)
    return [
      [(1 - c) / 2, 1 - c, (1 - c) / 2],
      [1 + alpha, -2 * c, 1 - alpha],
    ];
  if (kind === T.lowcut)
    return [
      [(1 + c) / 2, -(1 + c), (1 + c) / 2],
      [1 + alpha, -2 * c, 1 - alpha],
    ];
  const s = kind === T.lowshelf ? 1 : -1;
  return [
    [
      A * (A + 1 - s * (A - 1) * c + k),
      s * 2 * A * (A - 1 - s * (A + 1) * c),
      A * (A + 1 - s * (A - 1) * c - k),
    ],
    [A + 1 + s * (A - 1) * c + k, -s * 2 * (A - 1 + s * (A + 1) * c), A + 1 + s * (A - 1) * c - k],
  ];
}

/** The bilinear counterpart of `designEqBand`: the same cascade, cookbook sections. */
export function bilinearEqBand(band: EqBandDesign, sampleRate: number, out: Float64Array): number {
  const w0 =
    (2 * Math.PI * Math.min(band.freq, sampleRate * EQ_DSP.maxFrequencyRatio)) / sampleRate;
  const cutType = band.type === T.lowcut || band.type === T.highcut;
  if (!cutType) {
    write(out, 0, cookbook(band.type, w0, band.gain, band.q));
    return 1;
  }
  if (band.slope === 6) {
    write(out, 0, cookbook(band.type === T.highcut ? -1 : -2, w0, 0, 1));
    return 1;
  }
  const count = cutSectionCount(band.slope);
  for (let i = 0; i < count; i++) {
    const section = cookbook(band.type, w0, 0, cutSectionQ(band.slope, i, band.q));
    write(out, i * EQ_DSP.coefficientsPerSection, section);
  }
  return count;
}

const coeffs = new Float64Array(EQ_DSP.maxSections * EQ_DSP.coefficientsPerSection);

/** The largest |digital − analog| in dB from 20 Hz to `maxHz`, where the prototype is above the floor. */
export function bandError(
  band: EqBandDesign,
  sampleRate: number,
  form: EqForm,
  maxHz: number,
): number {
  const count =
    form === 'matched'
      ? designEqBand(band, sampleRate, coeffs)
      : bilinearEqBand(band, sampleRate, coeffs);
  const { lowHz, points, floorDb } = ACCURACY_GRID;
  let worst = 0;
  for (let i = 0; i < points; i++) {
    const f = lowHz * Math.pow(maxHz / lowHz, i / (points - 1));
    const analog = 10 * Math.log10(analogBandPower(band, f / band.freq));
    if (!(analog > floorDb)) continue;
    worst = Math.max(worst, Math.abs(sectionsDb(coeffs, count, f, sampleRate) - analog));
  }
  return worst;
}

/** The worst error over the grid's Qs and gains for one type, centre and rate (cuts at 12 dB/oct). */
export function worstError(
  type: number,
  centre: number,
  sampleRate: number,
  form: EqForm,
  maxHz: number,
): number {
  let worst = 0;
  for (const q of ACCURACY_GRID.qs)
    for (const gain of ACCURACY_GRID.gains) {
      const band = { type, slope: 12, freq: centre, gain, q };
      worst = Math.max(worst, bandError(band, sampleRate, form, maxHz));
    }
  return worst;
}

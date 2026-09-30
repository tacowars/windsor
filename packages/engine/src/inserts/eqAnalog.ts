/**
 * The Parametric EQ's analog prototypes (windsor#198): the power response
 * |H(jω)|² of each band type at a frequency ratio ω / ω0, the curve the
 * digital sections are fitted to and measured against. Bells and shelves are
 * the cookbook forms (A = 10^(dB / 40); Q never changes with gain), the
 * notch is (s² + ω0²) / (s² + s ω0 / Q + ω0²), and a cut is its sections'
 * product. Pure and allocation-free; `eqCoefficients.ts` fits the matched
 * shelf to it, and `eqCoefficients.test.ts` and the research bench measure
 * the digital sections against it.
 */
import {
  EQ_CUT_SECTION_Q,
  EQ_FIRST_ORDER_SLOPE,
  EQ_FLAT_Q,
  EQ_MATH as M,
  EQ_TYPE_ID as T,
} from './eqConstants';

/** The design-time view of a band: `type` an `EQ_TYPE_ID`, `gain` the heard dB. */
export interface EqBandDesign {
  type: number;
  slope: number;
  freq: number;
  gain: number;
  q: number;
}

/** |c − a ω² + j b ω|²: the power of one quadratic at ratio `w`. */
export function quadPower(a: number, b: number, c: number, w: number): number {
  const re = c - a * w * w;
  const im = b * w;
  return re * re + im * im;
}

/** The cookbook's A = 10^(dB / 40). */
export const shelfAmplitude = (gainDb: number): number =>
  Math.pow(M.decimal, gainDb / M.shelfDbPerDecade);

/** A low (`low`) or high shelf of amplitude `A` (see `shelfAmplitude`) at ratio `w`. */
export function analogShelfPower(low: boolean, w: number, A: number, q: number): number {
  const b = Math.sqrt(A) / q;
  return low
    ? (A * A * quadPower(1, b, A, w)) / quadPower(A, b, 1, w)
    : (A * A * quadPower(A, b, 1, w)) / quadPower(1, b, A, w);
}

export function analogBellPower(w: number, gainDb: number, q: number): number {
  const A = shelfAmplitude(gainDb);
  return quadPower(1, A / q, 1, w) / quadPower(1, 1 / (A * q), 1, w);
}

export function analogNotchPower(w: number, q: number): number {
  return quadPower(1, 0, 1, w) / quadPower(1, 1 / q, 1, w);
}

/** One second-order low- (`highpass` false) or high-pass section. */
export function analogPassPower(highpass: boolean, w: number, q: number): number {
  const top = highpass ? w * w * w * w : 1;
  return top / quadPower(1, 1 / q, 1, w);
}

/** The number of sections a cut of `slope` dB/oct runs (6 dB/oct is one first-order section). */
export function cutSectionCount(slope: number): number {
  return slope === EQ_FIRST_ORDER_SLOPE
    ? 1
    : EQ_CUT_SECTION_Q[slope as keyof typeof EQ_CUT_SECTION_Q].length;
}

/** Section `index`'s Q in a cut of `slope` dB/oct at the band's `q`: the last is scaled by q / √½. */
export function cutSectionQ(slope: number, index: number, q: number): number {
  const qs = EQ_CUT_SECTION_Q[slope as keyof typeof EQ_CUT_SECTION_Q];
  return index === qs.length - 1 ? q * (qs[index]! / EQ_FLAT_Q) : qs[index]!;
}

/** A cut of `slope` dB/oct: one first-order section, one at `q`, or a Butterworth cascade. */
export function analogCutPower(highpass: boolean, slope: number, w: number, q: number): number {
  if (slope === EQ_FIRST_ORDER_SLOPE) return highpass ? (w * w) / (1 + w * w) : 1 / (1 + w * w);
  let power = 1;
  const count = cutSectionCount(slope);
  for (let i = 0; i < count; i++) power *= analogPassPower(highpass, w, cutSectionQ(slope, i, q));
  return power;
}

/** The analog band at `w`, the frequency over the band's own. */
export function analogBandPower(band: EqBandDesign, w: number): number {
  switch (band.type) {
    case T.bell:
      return analogBellPower(w, band.gain, band.q);
    case T.notch:
      return analogNotchPower(w, band.q);
    case T.lowshelf:
    case T.highshelf:
      return analogShelfPower(band.type === T.lowshelf, w, shelfAmplitude(band.gain), band.q);
    default:
      return analogCutPower(band.type === T.lowcut, band.slope, w, band.q);
  }
}

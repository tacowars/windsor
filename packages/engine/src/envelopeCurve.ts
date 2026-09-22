/**
 * The envelope segment curve, once (#620 decision 4). The FM worklet (`worklet/fm/`)
 * shapes every attack, decay and release segment with this pair; the console's
 * envelope display (`tools/patch-editor/src/envCanvas.ts`) draws the same
 * pair, so a DSP curve change cannot leave the drawing lying. The worklet is
 * plain JS the harness evaluates, so the one definition is this module and
 * `envelopeCurve.test.ts` pins the worklet's `Envelope` to it sample for
 * sample.
 */
import { ENVELOPE_CURVE_STEEPNESS } from './audioConstants';

/** Monotonic 0..1 curve. `k == 1` is linear, `k < 1` bows up, `k > 1` bows down. */
export const curveShape = (p: number, k: number): number => p / (p + (1 - p) * k);

/** The shaping constant a segment's curve control (−1..1) selects. */
export const curveConstant = (curve: number): number => Math.exp(curve * ENVELOPE_CURVE_STEEPNESS);

/**
 * A segment's level at `phase` (0..1 of its duration), running from `from`
 * to `to` under `curve`: the worklet's `segStart + (target - segStart) * s`.
 */
export function segmentLevel(from: number, to: number, phase: number, curve: number): number {
  const k = curveConstant(curve);
  const s = k === 1 ? phase : curveShape(phase, k);
  return from + (to - from) * s;
}

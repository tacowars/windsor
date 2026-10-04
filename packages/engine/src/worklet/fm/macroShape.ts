/**
 * What a macro mapping plays (windsor#566, record `2026-10-04-patch-macro-knobs`
 * decision 4), for the main thread: the one scalar form of the arithmetic
 * `voiceMacros.ts` writes out in place on the audio thread, so a console
 * showing what a mapping plays and the voice agree.
 *
 * The macro value is inverted first, then shaped by multiplication (Linear,
 * Exp x³, Log 1 − (1 − x)³, S x²(3 − 2x)), and `min..max` is interpolated by
 * the shaped travel: geometrically on a `ratio` row (a cutoff sweeps in
 * octaves), its ends below the floor raised to it, and linearly on an `add`
 * row. The ends are clamped to the row first, as the patch normaliser
 * clamps them before the voice compiles them.
 *
 * Invariant: pure and import-free but for the curve ids and types, so it
 * never touches the worklet scope; the client project compiles it too.
 * `macroShape.test.ts` pins it to the voice over a sweep within 1e-12 (the
 * voice takes its powers through `portablePowers.ts`, this through `Math`).
 */

import type { MacroMapping } from '../../patch/patch';
import { MACRO_EXP, MACRO_LOG, MACRO_S } from './modeIds';
import type { VoiceTargetRow } from './voiceTargetTables';

/** The macro's travel `x` (0..1) through `curve`: inverted first, then Linear, Exp, Log or S. */
function shapeTravel(x: number, curve: number, inverted: boolean): number {
  const clamped = x < 0 ? 0 : x > 1 ? 1 : x;
  const t = inverted ? 1 - clamped : clamped;
  if (curve === MACRO_EXP) return t * t * t;
  if (curve === MACRO_LOG) return 1 - (1 - t) * (1 - t) * (1 - t);
  // eslint-disable-next-line no-magic-numbers -- smoothstep x²(3 − 2x), the curve's own arithmetic (record decision 4)
  if (curve === MACRO_S) return t * t * (3 - 2 * t);
  return t;
}

/**
 * The value `mapping` plays on its target's `row` at macro value `x`:
 * `min..max`, clamped to the row and on a ratio row raised to its floor (its
 * bottom where the row has none), interpolated by the shaped travel.
 */
function macroMappedValue(row: VoiceTargetRow, mapping: MacroMapping, x: number): number {
  const t = shapeTravel(x, mapping.curve, mapping.inverted);
  const bound = (v: number): number => (v < row.min ? row.min : v > row.max ? row.max : v);
  let lo = bound(mapping.min);
  let hi = bound(mapping.max);
  if (row.curve === 'ratio') {
    const floor = row.floor > 0 ? row.floor : row.min;
    if (lo < floor) lo = floor;
    if (hi < floor) hi = floor;
    if (lo > 0 && hi > 0) return lo * Math.exp(t * Math.log(hi / lo));
  }
  return lo + t * (hi - lo);
}

export { macroMappedValue };

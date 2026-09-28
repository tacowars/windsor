/**
 * The one step modulation curve (windsor#17): the value a `stepModTables.ts`
 * row plays for a lane value over the patch's own, in the row's curve space
 * and clamped to its bounds. The voice binds with it (`voiceStepMod.ts`),
 * and the main thread reads it through `index.ts`, so a console showing what
 * a step plays and the voice cannot disagree.
 *
 * Invariant: a lane value of exactly 0 returns the base untouched, neither
 * clamped nor passed through a curve, which is what keeps a note without
 * offsets bit for bit what it was (`fmProcessorGolden.test.ts`). Pure and
 * import-free but for the row's type, so it never touches the worklet scope;
 * allocation free. `stepModValue.test.ts` pins it.
 */

import type { StepModRow } from './stepModTables';

/**
 * The value `row` plays for lane value `v` (-1..1) over the patch's `base`:
 * `base + v × span` (linear), `base × 2^(v × span)` (octaves) or
 * `base × (max / min)^(v × span)` (the knob's log curve), clamped to
 * `min..max`. `v` of 0 is `base` exactly.
 */
function stepModValue(row: StepModRow, base: number, v: number): number {
  if (v === 0) return base;
  let x: number;
  if (row.curve === 'octaves') x = base * Math.pow(2, v * row.span);
  else if (row.curve === 'log') x = base * Math.pow(row.max / row.min, v * row.span);
  else x = base + v * row.span;
  return x < row.min ? row.min : x > row.max ? row.max : x;
}

export { stepModValue };

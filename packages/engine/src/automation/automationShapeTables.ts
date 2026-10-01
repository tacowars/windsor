/**
 * The stamped shapes' keys (windsor#341, record
 * `2026-10-01-song-automation-lanes` decision 12), as data: one cycle of each
 * cyclic shape as `(u, v, bend)` keys, `u` the fraction of the cycle and `v`
 * the height between the shape's bottom (0) and top (1). `automationShapes.ts`
 * repeats them over a range.
 */

/** The shapes a range can be stamped with. No random, no sample-and-hold. */
export const AUTOMATION_SHAPE_KINDS = [
  'triangle',
  'square',
  'sawUp',
  'sawDown',
  'sine',
  'ramp',
  'sCurve',
] as const;

export type AutomationShapeKind = (typeof AUTOMATION_SHAPE_KINDS)[number];

/** The shapes that repeat at the rate; ramp and S-curve span the range once. */
export type CyclicShapeKind = Exclude<AutomationShapeKind, 'ramp' | 'sCurve'>;

/** One key of a cycle. */
export interface ShapeKey {
  readonly u: number;
  readonly v: number;
  readonly bend: number;
}

/** The square's duty, the share of the cycle it spends at the top. */
export const SHAPE_DUTY_MIN = 0.1;
export const SHAPE_DUTY_MAX = 0.9;

/** The sine's quarter bends: each quarter bows away from the centre line. */
const SINE_BEND = 0.5;

/** The S-curve's two halves: bowed down from the bottom, then up into the top. */
export const SHAPE_S_CURVE_BEND = 0.6;

const key = (u: number, v: number, bend = 0): ShapeKey => ({ u, v, bend });

/**
 * One cycle of each cyclic shape. A key at `u = 1` lands on the next cycle's
 * `u = 0`, so the square and the saws step there.
 */
export const SHAPE_CYCLES: Readonly<
  Record<CyclicShapeKind, (duty: number) => readonly ShapeKey[]>
> = {
  triangle: () => [key(0, 0), key(0.5, 1)],
  square: (duty) => [key(0, 1), key(duty, 1), key(duty, 0), key(1, 0)],
  sawUp: () => [key(0, 0), key(1, 1)],
  sawDown: () => [key(0, 1), key(1, 0)],
  sine: () => [
    key(0, 0.5, SINE_BEND),
    key(0.25, 1, SINE_BEND),
    key(0.5, 0.5, -SINE_BEND),
    key(0.75, 0, -SINE_BEND),
  ],
};

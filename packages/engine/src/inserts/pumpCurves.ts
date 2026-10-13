/**
 * The Pump's shape and length as numbers (record `2026-10-13-pump-insert`
 * decision 3), shared by the worklet and the card's editor so that what is
 * drawn is what plays: `pumpDsp.test.ts` pins the worklet's gain against
 * `pumpLevelAt` sample for sample.
 *
 * A segment's curve is the rational bend `u / (u + β(1 − u))` with
 * β = (1 − bend) / (1 + bend): straight at bend 0, early above 0 (it leaves
 * fast and settles), late below 0, mirrored by the bend's sign, one
 * division a sample and no transcendental. The worklet evaluates the same
 * expression inline over β from `bendBeta`.
 */
import { PUMP_DIVISION_BEATS } from './pumpConstants';
import type { PumpDivision } from './pumpConstants';

interface PumpPointLike {
  readonly at: number;
  readonly level: number;
  readonly bend: number;
}

const MS_PER_MINUTE = 60000;

/** The rational bend's β for `bend` in (−1, 1). */
export const bendBeta = (bend: number): number => (1 - bend) / (1 + bend);

/** The bent position of `u` in [0, 1] for `bend`. */
export function bendShape(u: number, bend: number): number {
  const beta = bendBeta(bend);
  return u / (u + beta * (1 - u));
}

/**
 * The shape's level at `phase` in [0, 1]: the segment whose span holds it
 * (the last that starts at or before it, so a vertical step takes its upper
 * point), bent from its start; past 1, the last point's level.
 */
export function pumpLevelAt(points: readonly PumpPointLike[], phase: number): number {
  const last = points.length - 1;
  if (phase >= 1) return points[last]!.level;
  let seg = 0;
  while (seg < last - 1 && phase >= points[seg + 1]!.at) seg++;
  const from = points[seg]!,
    to = points[seg + 1]!;
  const width = to.at - from.at;
  const u = width > 0 ? (phase - from.at) / width : 1;
  return from.level + (to.level - from.level) * bendShape(u, from.bend);
}

/** The cycle's length in ms: the division at `bpm` when synced, else the spec's own. */
export function pumpLengthMs(
  spec: { readonly sync: boolean; readonly division: PumpDivision; readonly lengthMs: number },
  bpm: number,
): number {
  return spec.sync ? (PUMP_DIVISION_BEATS[spec.division] * MS_PER_MINUTE) / bpm : spec.lengthMs;
}

/** The gain a level plays at `depth`: unity at depth 0, the level itself at 1. */
export const pumpGain = (level: number, depth: number): number => 1 - depth * (1 - level);

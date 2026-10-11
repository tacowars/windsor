/**
 * A clip envelope's value at a loop tick (windsor#701, epic windsor#699
 * decisions 3 and 4), read through the song lanes' own evaluator
 * (`automationEvaluate.ts`) on `ROLL_ENVELOPE_ROW`, so the curve and its
 * bends are theirs, not a copy:
 *
 * - before the first point the value is the first point's, after the last
 *   point the last's;
 * - an envelope with no points, or switched off, reads 0;
 * - a point at or past the loop is kept and never read, like a note there:
 *   the value holds from the last point inside the loop.
 *
 * Kept apart from `rollEnvelope.ts`, which the Roll's config imports, because
 * the evaluator reaches the automation modules, outside the generators' pure
 * set. Pure, and allocates nothing; `rollEnvelope.test.ts`.
 */
import { firstPointPast, valueAt } from '../automation/automationEvaluate';
import type { RollEnvelope } from './rollEnvelope';
import { ROLL_ENVELOPE_ROW } from './rollEnvelopeTables';

/**
 * How many of the envelope's points the loop hears: those before
 * `loopTicks`; 0 when it is off. The one rule for "inside the loop", which
 * `envelopeValueAt` reads by and `envelopeHeard` admits by.
 */
function pointsHeard(envelope: RollEnvelope, loopTicks: number): number {
  return envelope.on ? firstPointPast(envelope.points, loopTicks, false) : 0;
}

/**
 * Whether `envelopeValueAt` can read anything but 0 over a loop of
 * `loopTicks`: the envelope is on and has a point inside the loop
 * (windsor#702: only such an envelope takes a voice slot).
 */
export const envelopeHeard = (envelope: RollEnvelope, loopTicks = Infinity): boolean =>
  pointsHeard(envelope, loopTicks) > 0;

/**
 * The envelope's value, −1..1, at loop tick `loopTick`
 * (0..`loopTicks` − 1, the region's local tick mod the loop). With
 * `loopTicks`, the points at or past it are not read: past the last point
 * inside the loop its value holds. Off, or with no point inside the loop, 0.
 */
export function envelopeValueAt(
  envelope: RollEnvelope,
  loopTick: number,
  loopTicks = Infinity,
): number {
  const { points } = envelope;
  const heard = pointsHeard(envelope, loopTicks);
  if (heard === 0) return 0;
  const last = points[heard - 1]!;
  // Before the last point heard, the segment around `loopTick` is all inside the loop.
  if (loopTick >= last.tick) return last.value;
  return valueAt(ROLL_ENVELOPE_ROW, points, loopTick);
}

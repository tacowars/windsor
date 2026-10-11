/**
 * The Roll's clip envelopes (windsor#701, epic windsor#699 decisions 1–4 and
 * 6): curves a roll carries beside its notes, in its own loop-local ticks,
 * which loop with `loopTicks` and travel with the region's `pattern`.
 *
 * An envelope names one voice target (`VoiceTargetPath`, any row of the
 * voice target table, macros included) and holds a song lane's points
 * (`{tick, value, bend}`), each value −1..1 with 0 the patch's own setting,
 * as a step lane's is. Unlike a song lane's, its ticks strictly increase:
 * no two points share one.
 *
 * This file is the type, the caps and the check, which `assertRollConfig`
 * runs; it stays on the generators' pure side with the Roll's config. The
 * evaluator, over the song lanes' own curve, is `rollEnvelopeValue.ts`;
 * `song/rollNormalise.ts` makes a document's envelopes pass the check.
 * Playing them is windsor#702's. `rollEnvelope.test.ts`.
 */
import type { VoiceTargetPath } from '../worklet/fm/voiceTargetTables';
import { ROLL_ENVELOPE_POINTS_MAX } from './rollEnvelopeTables';
// A cycle with `rollSequencer.ts`, which imports the check: each module reads
// the other's binding only inside a function, never as it loads.
import { ROLL_LOOP_TICKS_MAX } from './rollSequencer';
import { isVoiceTargetPath } from './stepModLanes';

/** The most envelopes one roll carries, each on its own target (epic windsor#699 decision 6). */
export const ROLL_ENVELOPES_MAX = 4;

/**
 * One point: a song lane's `AutomationPoint` (`automation/automationLane.ts`),
 * restated because that module sits outside the generators' pure set. The
 * two are the same shape, so either passes for the other.
 */
export interface RollEnvelopePoint {
  /** A loop-local tick, 0..`ROLL_LOOP_TICKS_MAX` − 1; fractional allowed, as on a song lane. */
  readonly tick: number;
  /** −1..1, 0 being the patch's own setting. */
  readonly value: number;
  /** −1..1: the curve of the segment after this point, 0 straight. */
  readonly bend: number;
}

/** One clip envelope: its voice target, whether it plays, and its points. */
export interface RollEnvelope {
  readonly target: VoiceTargetPath;
  readonly on: boolean;
  /** At most `ROLL_ENVELOPE_POINTS_MAX`, ticks strictly increasing. */
  readonly points: readonly RollEnvelopePoint[];
}

const within = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max;

function assertPoints(points: readonly RollEnvelopePoint[], at: string): void {
  if (!Array.isArray(points) || points.length > ROLL_ENVELOPE_POINTS_MAX) {
    throw new RangeError(`${at}.points must be a list of at most ${ROLL_ENVELOPE_POINTS_MAX}`);
  }
  points.forEach((point, i) => {
    const where = `${at}.points[${i}]`;
    if (!within(point.tick, 0, ROLL_LOOP_TICKS_MAX - 1)) {
      throw new RangeError(`${where}.tick must be in [0, ${ROLL_LOOP_TICKS_MAX - 1}]`);
    }
    if (i > 0 && !(point.tick > points[i - 1]!.tick)) {
      throw new RangeError(`${where}.tick must be after the point before it`);
    }
    if (!within(point.value, -1, 1)) throw new RangeError(`${where}.value must be in [-1, 1]`);
    if (!within(point.bend, -1, 1)) throw new RangeError(`${where}.bend must be in [-1, 1]`);
  });
}

/**
 * At most `ROLL_ENVELOPES_MAX` envelopes, each on a voice target no other
 * names, each with its points in range and strictly in tick order.
 */
export function assertRollEnvelopes(envelopes: readonly RollEnvelope[]): void {
  if (!Array.isArray(envelopes) || envelopes.length > ROLL_ENVELOPES_MAX) {
    throw new RangeError(`envelopes must be a list of at most ${ROLL_ENVELOPES_MAX}`);
  }
  const seen = new Set<VoiceTargetPath>();
  envelopes.forEach((envelope, i) => {
    const at = `envelopes[${i}]`;
    if (!isVoiceTargetPath(envelope.target)) {
      throw new RangeError(`${at}.target ${String(envelope.target)} is not a VoiceTargetPath`);
    }
    if (seen.has(envelope.target)) throw new RangeError(`${at}.target ${envelope.target} repeats`);
    seen.add(envelope.target);
    if (typeof envelope.on !== 'boolean') throw new RangeError(`${at}.on must be a boolean`);
    assertPoints(envelope.points, at);
  });
}

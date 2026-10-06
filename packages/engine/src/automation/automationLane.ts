/**
 * The automation lane's shape (windsor#341, record
 * `2026-10-01-song-automation-lanes` decisions 2–5): a part's curve over song
 * time, as points in the target's own units, each bending the segment after
 * it. The song format (windsor#342), the player (windsor#344) and the Song
 * tab (windsor#348) all build on these types. Pure: no Web Audio, no worklet
 * scope. `automationLane.test.ts` pins `pointsInOrder`.
 */
import type { SeqField } from '../sequencing/regionGate';
import type { VOICE_PREFIX } from './automationTargets';

/** A strip target: the part's fader, pan and two sends. */
export type StripTargetId = 'strip.level' | 'strip.pan' | 'strip.send.a' | 'strip.send.b';

/** An insert target: the insert's stable id (`inserts/insertIds.ts`), then its field. */
export type InsertTargetId = `insert.${string}.${string}`;

/**
 * A voice target: a patch path, as `voiceTargetTables.ts` spells it
 * (`voice.ops.2.width`), under the prefix `automationTargets.ts` owns.
 */
export type VoiceTargetId = `${typeof VOICE_PREFIX}${string}`;

/**
 * A sequencer target (windsor#488): a field the part's generators read on
 * their onset, which the region gate hands them from the lane.
 */
export type SeqTargetId = `seq.${SeqField}`;

/** What a lane moves, relative to the part that owns it (decision 2). */
export type AutomationTargetId = StripTargetId | InsertTargetId | VoiceTargetId | SeqTargetId;

/** The four families of target. */
export type AutomationTargetKind = 'strip' | 'insert' | 'voice' | 'seq';

/** A target id taken apart. */
export type ParsedTarget =
  | { readonly kind: 'strip'; readonly field: string }
  | { readonly kind: 'insert'; readonly insertId: string; readonly field: string }
  | { readonly kind: 'voice'; readonly path: string }
  | { readonly kind: 'seq'; readonly field: SeqField };

/**
 * How a target's value maps onto the lane's height (decision 5):
 * - `db`: a linear gain drawn in decibels, from the row's floor to its max;
 * - `octaves` and `log`: logarithmic in the value;
 * - `linear`: linear;
 * - `switch` (windsor#628): 0 off, 1 on, held from each point to the next
 *   and never ramped (`automationEvaluate.ts`).
 */
export type AutomationScale = 'db' | 'octaves' | 'log' | 'linear' | 'switch';

/** One target the catalog offers: its bounds, its scale and how it reads. */
export interface AutomationTargetRow {
  /** A strip or voice row's full target id; an insert row's field under the insert. */
  readonly target: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly scale: AutomationScale;
  /** The unit the value reads in (`Hz`, `dB`, `s`), or '' for a plain number. */
  readonly unit: string;
  /**
   * A logarithmic row's display floor, in the row's own units, when `min` is
   * 0 or the row is `db`: the bottom of the lane, below which every value
   * sits at 0.
   */
  readonly floor?: number;
}

/** One point of a lane. */
export interface AutomationPoint {
  /** An absolute song tick. Fractional where a stamped shape lands between ticks. */
  readonly tick: number;
  /** In the target's own units. */
  readonly value: number;
  /** −1..1: the curve of the segment after this point, 0 straight. */
  readonly bend: number;
}

/** One lane: a target, whether it plays, and its points in tick order. */
export interface AutomationLane {
  readonly target: AutomationTargetId;
  readonly on: boolean;
  /** Ordered by tick. Two points may share a tick, which is a vertical step. */
  readonly points: readonly AutomationPoint[];
}

/** Whether `points` are in tick order (equal ticks allowed: a step). */
export function pointsInOrder(points: readonly AutomationPoint[]): boolean {
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.tick < points[i - 1]!.tick) return false;
  }
  return true;
}

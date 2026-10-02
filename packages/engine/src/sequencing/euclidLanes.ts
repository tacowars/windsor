/**
 * A Euclid part's rows beside its trigger (windsor#355, record
 * `2026-10-01-euclid-lanes-and-ratchets`): the ratchet row above it and the
 * drawn lanes below it, all on the trigger's one clock.
 *
 * - The **ratchet row** holds a roll of 1 to `EUCLID_RATCHET_MAX` hits per
 *   trigger step. It is keyed to the step, not the hit: it sounds only where
 *   the trigger lands, so a density change can move a hit onto or off it.
 * - A **lane** (accent, pitch, or a step-modulation lane) is 1 to
 *   `EUCLID_LANE_STEPS_MAX` steps long, its length its array's. It reads
 *   index `localStep mod length`, the step the trigger has counted since its
 *   region's entry, so every lane restarts where the trigger restarts, and
 *   lanes of other lengths fall against the hits in polymeter. A lane is read
 *   at a hit only: it never makes one, and its value under a rest is unheard.
 *
 * Every field is optional and absent is a plain hit: one roll, no accent, no
 * transposition, no offsets, so a part written before these rows plays as it
 * did. The density modulator re-cuts only the trigger; nothing here moves.
 * Pure, with no audio: the player turns a read into note-ons
 * (`partNoteOn.ts`'s `euclidNoteOn`). `euclidLanes.test.ts`.
 */
import {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  EUCLID_LANE_STEPS_MAX,
  EUCLID_PITCH_LANE_MAX,
  EUCLID_RATCHET_MAX,
  EUCLID_STEPS_MAX,
} from '../audioConstants';
import { assertStepModLanes, stepModAtCycle, type StepModLane } from './stepModLanes';
import { swingTicks } from './swing';
import type { Swing } from './swingTables';

/** The rows a Euclid config carries beside its trigger; each absent is today's plain hit. */
export interface EuclidRows {
  /**
   * One roll per trigger step, each 1 to `EUCLID_RATCHET_MAX` hits; absent is
   * all 1. The normaliser fits it to `steps`; a step past its end reads 1, so
   * a live Steps edit that does not carry it along still plays.
   */
  ratchets?: readonly number[];
  /** The bump an accented hit adds to the part's velocity, 0–1; absent is `ACCENT_VELOCITY_DEFAULT`. */
  accentVelocity?: number;
  /** The per-note mod an accented hit sends, 0–1; absent is `ACCENT_MOD_DEFAULT`. */
  accentMod?: number;
  /** On or off per lane step; absent is no accent lane. */
  accentLane?: readonly boolean[];
  /** Whole semitones per lane step, `±EUCLID_PITCH_LANE_MAX`, added to the part's `note`; absent is none. */
  pitchLane?: readonly number[];
  /** At most `STEP_MOD_LANES_MAX` lanes, each `VoiceTargetPath` once, each its own length; absent is none. */
  modLanes?: readonly StepModLane[];
}

/**
 * Every row's key. Each is optional, so a normalised song may lack any of
 * them: the normaliser keeps these and the merge lets a partial add one.
 */
export const EUCLID_ROW_KEYS = [
  'ratchets',
  'accentVelocity',
  'accentMod',
  'accentLane',
  'pitchLane',
  'modLanes',
] as const satisfies ReadonlyArray<keyof EuclidRows>;

/** What one hit's step gives it from the rows. */
export interface EuclidHitRead {
  /** Hits in the step's roll: 1 for a plain hit. */
  readonly ratchet: number;
  /** The accent's velocity bump and mod, as a grid accent carries them; undefined unaccented. */
  readonly accent: { readonly velocity: number; readonly mod: number } | undefined;
  /** Semitones the pitch lane adds to the part's note; 0 without one. */
  readonly semitones: number;
  /** The offsets, one slot per table row; undefined when every mod lane reads 0. */
  readonly stepMod: number[] | undefined;
}

/** The index a lane of `length` steps reads at the trigger's local step. */
export const laneStep = (localStep: number, length: number): number =>
  ((localStep % length) + length) % length;

/** What the rows give a hit on figure step `step`, the trigger's `localStep`-th since its entry. */
export function euclidHitRead(rows: EuclidRows, step: number, localStep: number): EuclidHitRead {
  const { accentLane, pitchLane, modLanes } = rows;
  const accented =
    accentLane !== undefined &&
    accentLane.length > 0 &&
    accentLane[laneStep(localStep, accentLane.length)] === true;
  const semitones =
    pitchLane !== undefined && pitchLane.length > 0
      ? (pitchLane[laneStep(localStep, pitchLane.length)] ?? 0)
      : 0;
  return {
    ratchet: rows.ratchets?.[step] ?? 1,
    accent: accented
      ? {
          velocity: rows.accentVelocity ?? ACCENT_VELOCITY_DEFAULT,
          mod: rows.accentMod ?? ACCENT_MOD_DEFAULT,
        }
      : undefined,
    semitones,
    stepMod: modLanes === undefined ? undefined : stepModAtCycle(modLanes, localStep),
  };
}

/** Where a roll is on the transport: the step's transport tick, the ticks it spans, the tempo and the swing. */
export interface RollClock {
  /** The step's transport tick (the swing's phase), never a region's local tick. */
  readonly tick: number;
  /** The step's divisor, or fewer where its region ends or the loop jumps first (`rollSpan.ts`). */
  readonly ticks: number;
  readonly secondsPerTick: number;
  readonly swing: Swing;
}

/**
 * Seconds from a step's time to `ticks` later, both as swing leaves them:
 * the span a ratchet's roll divides evenly. Over a whole step it ends at the
 * next step's swung time; straight, it is the ticks at the tempo.
 */
export function rollSpanSeconds({ tick, ticks, secondsPerTick, swing }: RollClock): number {
  return (swingTicks(tick + ticks, swing) - swingTicks(tick, swing)) * secondsPerTick;
}

const isLaneLength = (lane: readonly unknown[]): boolean =>
  lane.length >= 1 && lane.length <= EUCLID_LANE_STEPS_MAX;

function assertLane(
  name: string,
  lane: readonly unknown[] | undefined,
  ok: (v: unknown) => boolean,
): void {
  if (lane === undefined) return;
  if (!isLaneLength(lane)) {
    throw new RangeError(`${name} must be 1–${EUCLID_LANE_STEPS_MAX} steps, got ${lane.length}`);
  }
  if (!lane.every(ok)) throw new RangeError(`${name} holds a value out of range`);
}

const isUnit = (v: number | undefined): boolean => v === undefined || (v >= 0 && v <= 1);

/** The constructor's and `reconfigure`'s check of the rows; the normaliser makes a document's pass it. */
export function assertEuclidRows(rows: EuclidRows): void {
  const { ratchets, modLanes } = rows;
  if (ratchets !== undefined) {
    const inRange = (v: number): boolean =>
      Number.isInteger(v) && v >= 1 && v <= EUCLID_RATCHET_MAX;
    if (ratchets.length > EUCLID_STEPS_MAX || !ratchets.every(inRange)) {
      throw new RangeError(`ratchets must each be an integer 1–${EUCLID_RATCHET_MAX}`);
    }
  }
  if (!isUnit(rows.accentVelocity) || !isUnit(rows.accentMod)) {
    throw new RangeError('accentVelocity and accentMod must be in [0, 1]');
  }
  assertLane('accentLane', rows.accentLane, (v) => typeof v === 'boolean');
  assertLane(
    'pitchLane',
    rows.pitchLane,
    (v) => Number.isInteger(v) && Math.abs(v as number) <= EUCLID_PITCH_LANE_MAX,
  );
  if (modLanes === undefined) return;
  assertStepModLanes(modLanes);
  modLanes.forEach((lane, i) => assertLane(`modLanes[${i}]`, lane.values, () => true));
}

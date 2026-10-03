/**
 * The Euclid card's drawn lanes (windsor#356; the lanes are the engine's,
 * windsor#355, record `2026-10-01-euclid-lanes-and-ratchets` decisions 2–4):
 * which lanes a part has, in the card's order (accent, pitch, then the
 * sound lanes), what the Add lane picker offers, and the fields an edit
 * writes. A lane's length is its array's, 1 to `EUCLID_LANE_STEPS_MAX`.
 *
 * Every write is a sequencer partial for `changePattern`: a whole array per
 * row, since arrays replace wholesale. A row set to `undefined` is removed
 * from the pattern (`withRows`), which a merge cannot say.
 */
import type { EuclidRows, Patch, StepModLane, VoiceTargetPath } from '@windsor/engine';
import {
  EUCLID_LANE_STEPS_MAX,
  EUCLID_PITCH_LANE_MAX,
  STEP_MOD_LANES_MAX,
  VOICE_TARGET_PATHS,
  isVoiceTargetPath,
} from '@windsor/engine';
import { offersVoicePath } from './macroTargets';
import { addLane, laneLabel } from './stepModLaneModel';

/** A lane by what it is: the one accent lane, the one pitch lane, or the sound lane for a parameter. */
export type EuclidLaneRef =
  | { readonly kind: 'accent' }
  | { readonly kind: 'pitch' }
  | { readonly kind: 'sound'; readonly param: VoiceTargetPath };

/** A sequencer partial the card writes; a row set to `undefined` is removed. */
export type RowFields = Readonly<Record<string, unknown>>;

const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

/** A lane length held to the engine's 1–`EUCLID_LANE_STEPS_MAX`. */
export const clampLaneLength = (length: number): number =>
  clampInt(length, 1, EUCLID_LANE_STEPS_MAX);

/** A pitch value held to whole semitones within ±`EUCLID_PITCH_LANE_MAX`. */
export const clampPitch = (semitones: number): number =>
  clampInt(semitones, -EUCLID_PITCH_LANE_MAX, EUCLID_PITCH_LANE_MAX) || 0;

/** The part's lanes in the card's order: accent, pitch, then each sound lane as the list holds it. */
export function lanesOf(rows: EuclidRows): EuclidLaneRef[] {
  const lanes: EuclidLaneRef[] = [];
  if (rows.accentLane) lanes.push({ kind: 'accent' });
  if (rows.pitchLane) lanes.push({ kind: 'pitch' });
  for (const lane of rows.modLanes ?? []) lanes.push({ kind: 'sound', param: lane.param });
  return lanes;
}

const soundIndex = (rows: EuclidRows, param: VoiceTargetPath): number =>
  (rows.modLanes ?? []).findIndex((lane) => lane.param === param);

/** A lane's values, numbers for every kind (an accent's on is 1); empty when the lane is gone. */
export function laneValues(rows: EuclidRows, ref: EuclidLaneRef): readonly number[] {
  if (ref.kind === 'accent') return (rows.accentLane ?? []).map((on) => (on ? 1 : 0));
  if (ref.kind === 'pitch') return rows.pitchLane ?? [];
  return rows.modLanes?.[soundIndex(rows, ref.param)]?.values ?? [];
}

export const laneLength = (rows: EuclidRows, ref: EuclidLaneRef): number =>
  laneValues(rows, ref).length;

/** The name a lane's row shows; a macro's is the name `patch` (the part's) gives it. */
export function laneName(ref: EuclidLaneRef, patch?: Patch): string {
  if (ref.kind === 'accent') return 'Accent';
  if (ref.kind === 'pitch') return 'Pitch';
  return laneLabel(ref.param, patch);
}

/** A list padded with `fill` or trimmed to `length`. */
const fit = <T>(values: readonly T[], length: number, fill: T): T[] =>
  Array.from({ length }, (_, i) => values[i] ?? fill);

/** The sound lanes with the one for `param` given `values`. */
const withSound = (
  rows: EuclidRows,
  param: VoiceTargetPath,
  values: readonly number[],
): StepModLane[] =>
  (rows.modLanes ?? []).map((lane) => (lane.param === param ? { ...lane, values } : lane));

/** The row a lane's whole value list writes. */
function writeValues(rows: EuclidRows, ref: EuclidLaneRef, values: readonly number[]): RowFields {
  if (ref.kind === 'accent') return { accentLane: values.map((v) => v !== 0) };
  if (ref.kind === 'pitch') return { pitchLane: values.map(clampPitch) };
  return { modLanes: withSound(rows, ref.param, values) };
}

/** The lane at `length` steps, 1–32: padded with 0 (an accent off) or trimmed. */
export function resizeLane(rows: EuclidRows, ref: EuclidLaneRef, length: number): RowFields {
  return writeValues(rows, ref, fit(laneValues(rows, ref), clampLaneLength(length), 0));
}

/** The lane removed: its row gone, or, for a sound lane with others beside it, the list without it. */
export function removeLane(rows: EuclidRows, ref: EuclidLaneRef): RowFields {
  if (ref.kind === 'accent') return { accentLane: undefined };
  if (ref.kind === 'pitch') return { pitchLane: undefined };
  const rest = (rows.modLanes ?? []).filter((lane) => lane.param !== ref.param);
  return { modLanes: rest.length > 0 ? rest : undefined };
}

/** Accent step `index` flipped. */
export function toggleAccent(rows: EuclidRows, index: number): RowFields {
  const lane = rows.accentLane ?? [];
  return { accentLane: lane.map((on, i) => (i === index ? !on : on)) };
}

/** Pitch step `index` set to `semitones`, whole and within ±24. */
export function setPitch(rows: EuclidRows, index: number, semitones: number): RowFields {
  const lane = rows.pitchLane ?? [];
  return { pitchLane: lane.map((v, i) => (i === index ? clampPitch(semitones) : v)) };
}

/** The pitch a vertical drag of `dy` px (down positive) from `start` sets, at `pxPerSemitone`. */
export const pitchFromDrag = (start: number, dy: number, pxPerSemitone: number): number =>
  clampPitch(start - dy / pxPerSemitone);

/** A choice in the Add lane picker: its value (`accent`, `pitch` or a parameter), its label, and whether it is open. */
export interface LaneChoice {
  readonly value: string;
  readonly label: string;
  readonly disabled: boolean;
}

/**
 * Accent and Pitch once each, then every sound parameter once, up to
 * `STEP_MOD_LANES_MAX` sound lanes; a macro only where `patch` (the part's)
 * defines it, under its name (windsor#559).
 */
export function laneChoices(
  rows: EuclidRows,
  patch?: Patch,
  max = STEP_MOD_LANES_MAX,
): LaneChoice[] {
  const sound = rows.modLanes ?? [];
  const full = sound.length >= max;
  return [
    { value: 'accent', label: 'Accent', disabled: rows.accentLane !== undefined },
    { value: 'pitch', label: 'Pitch', disabled: rows.pitchLane !== undefined },
    ...VOICE_TARGET_PATHS.filter((param) => offersVoicePath(patch, param)).map((param) => ({
      value: param,
      label: laneLabel(param, patch),
      disabled: full || sound.some((lane) => lane.param === param),
    })),
  ];
}

/**
 * The lane a picker choice adds, `min(steps, 32)` long with every value at
 * 0 (an accent off); null when the choice is taken, unknown, a macro
 * `patch` does not define, or the sound lanes are full.
 */
export function addLaneRow(
  rows: EuclidRows,
  choice: string,
  steps: number,
  patch?: Patch,
): RowFields | null {
  const length = clampLaneLength(Math.min(steps, EUCLID_LANE_STEPS_MAX));
  const open = laneChoices(rows, patch).find((c) => c.value === choice);
  if (!open || open.disabled) return null;
  if (choice === 'accent') return { accentLane: new Array<boolean>(length).fill(false) };
  if (choice === 'pitch') return { pitchLane: new Array<number>(length).fill(0) };
  if (!isVoiceTargetPath(choice)) return null;
  const next = addLane(rows.modLanes ?? [], choice, length);
  return next && { modLanes: next };
}

/**
 * A pattern with `fields` written over it and every row set to `undefined`
 * removed: what a write that removes a lane puts in its region whole.
 */
export function withRows<P extends object>(pattern: P, fields: RowFields): P {
  const out = { ...pattern } as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  // Only rows of the pattern's own kind are written or removed, so the shape is still `P`.
  return out as P;
}

/** True when `fields` removes a row, which only a whole-pattern write can say. */
export const removesRow = (fields: RowFields): boolean =>
  Object.values(fields).some((value) => value === undefined);

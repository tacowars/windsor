/**
 * Step modulation lanes (windsor#17): per-step, relative parameter offsets a
 * step sequencer carries beside its steps, like parameter locks that push
 * the patch's own setting up or down for that step's note only. A lane
 * names one voice target (`VoiceTargetPath`, any row of the voice target
 * table, windsor#419) and holds one value in -1..1 per step, 0 being the
 * patch's setting; the worklet turns a value into the played one through
 * the row's curve and span (`worklet/fm/voiceTargetTables.ts`). The model is
 * the sequencer kind's to adopt: the grid carries it first.
 *
 * `stepModAt` is what a sequencer sends with a step's note-on: one slot per
 * table row, or nothing when every lane reads 0 there, so a line without
 * lanes emits exactly what it did before. `assertStepModLanes` is the
 * constructor's check; `sequencerNormalise.ts` makes a document's lanes pass
 * it. Pure: `generatorBoundary.test.ts`; `stepModLanes.test.ts`.
 */
import {
  VOICE_TARGET_COUNT,
  VOICE_TARGET_PATHS,
  type VoiceTargetPath,
} from '../worklet/fm/voiceTargetTables';

/** The most lanes one sequencer carries (windsor#17 decision 4). */
export const STEP_MOD_LANES_MAX = 4;

/** One lane: the target it pushes and its value per step, -1..1. */
export interface StepModLane {
  readonly param: VoiceTargetPath;
  readonly values: readonly number[];
}

/** Whether `value` names a voice target, which a lane may modulate. */
export function isVoiceTargetPath(value: unknown): value is VoiceTargetPath {
  return (VOICE_TARGET_PATHS as readonly unknown[]).includes(value);
}

/**
 * The offsets a note on `step` carries, one slot per table row in code
 * order, or undefined when every lane reads 0 there. A lane shorter than
 * the line reads 0 past its end.
 */
export function stepModAt(lanes: readonly StepModLane[], step: number): number[] | undefined {
  let offsets: number[] | undefined;
  for (const lane of lanes) {
    const value = lane.values[step] ?? 0;
    if (value === 0) continue;
    offsets ??= new Array<number>(VOICE_TARGET_COUNT).fill(0);
    offsets[VOICE_TARGET_PATHS.indexOf(lane.param)] = value;
  }
  return offsets;
}

/**
 * The offsets at a sequencer's local step when each lane runs at its own
 * length (windsor#355's Euclid lanes): lane by lane, index `localStep mod`
 * that lane's length, in `stepModAt`'s code order, and undefined when every
 * lane reads 0 there, so such a step allocates nothing. An empty lane reads 0.
 */
export function stepModAtCycle(
  lanes: readonly StepModLane[],
  localStep: number,
): number[] | undefined {
  let offsets: number[] | undefined;
  for (const lane of lanes) {
    const length = lane.values.length;
    if (length === 0) continue;
    const value = lane.values[((localStep % length) + length) % length] ?? 0;
    if (value === 0) continue;
    offsets ??= new Array<number>(VOICE_TARGET_COUNT).fill(0);
    offsets[VOICE_TARGET_PATHS.indexOf(lane.param)] = value;
  }
  return offsets;
}

/** At most `STEP_MOD_LANES_MAX` lanes, each a known parameter once, every value finite in -1..1. */
export function assertStepModLanes(lanes: readonly StepModLane[]): void {
  if (lanes.length > STEP_MOD_LANES_MAX) {
    throw new RangeError(`lanes must hold at most ${STEP_MOD_LANES_MAX}, got ${lanes.length}`);
  }
  const seen = new Set<VoiceTargetPath>();
  lanes.forEach((lane, i) => {
    if (!isVoiceTargetPath(lane.param)) {
      throw new RangeError(`lanes[${i}].param ${String(lane.param)} is not a VoiceTargetPath`);
    }
    if (seen.has(lane.param)) throw new RangeError(`lanes[${i}].param ${lane.param} repeats`);
    seen.add(lane.param);
    if (!lane.values.every((v) => v >= -1 && v <= 1)) {
      throw new RangeError(`lanes[${i}].values must each be in [-1, 1]`);
    }
  });
}

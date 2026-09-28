/**
 * Step modulation lanes (windsor#17): per-step, relative parameter offsets a
 * step sequencer carries beside its steps, like parameter locks that push
 * the patch's own setting up or down for that step's note only. A lane
 * names one `StepModParam` and holds one value in -1..1 per step, 0 being
 * the patch's setting; the worklet turns a value into the played one through
 * `STEP_MOD_TABLE` (`worklet/fm/stepModTables.ts`). The model is the
 * sequencer kind's to adopt: the grid carries it first.
 *
 * `stepModAt` is what a sequencer sends with a step's note-on: one slot per
 * table row, or nothing when every lane reads 0 there, so a line without
 * lanes emits exactly what it did before. `assertStepModLanes` is the
 * constructor's check; `sequencerNormalise.ts` makes a document's lanes pass
 * it. Pure: `generatorBoundary.test.ts`; `stepModLanes.test.ts`.
 */
import {
  STEP_MOD_LANES_MAX,
  STEP_MOD_PARAMS,
  STEP_MOD_SLOT_COUNT,
  type StepModParam,
} from '../worklet/fm/stepModTables';

/** One lane: the parameter it pushes and its value per step, -1..1. */
export interface StepModLane {
  readonly param: StepModParam;
  readonly values: readonly number[];
}

/** Whether `value` names a parameter a lane may modulate. */
export function isStepModParam(value: unknown): value is StepModParam {
  return (STEP_MOD_PARAMS as readonly unknown[]).includes(value);
}

/**
 * The offsets a note on `step` carries, one slot per table row in slot
 * order, or undefined when every lane reads 0 there. A lane shorter than
 * the line reads 0 past its end.
 */
export function stepModAt(lanes: readonly StepModLane[], step: number): number[] | undefined {
  let offsets: number[] | undefined;
  for (const lane of lanes) {
    const value = lane.values[step] ?? 0;
    if (value === 0) continue;
    offsets ??= new Array<number>(STEP_MOD_SLOT_COUNT).fill(0);
    offsets[STEP_MOD_PARAMS.indexOf(lane.param)] = value;
  }
  return offsets;
}

/** At most `STEP_MOD_LANES_MAX` lanes, each a known parameter once, every value finite in -1..1. */
export function assertStepModLanes(lanes: readonly StepModLane[]): void {
  if (lanes.length > STEP_MOD_LANES_MAX) {
    throw new RangeError(`lanes must hold at most ${STEP_MOD_LANES_MAX}, got ${lanes.length}`);
  }
  const seen = new Set<StepModParam>();
  lanes.forEach((lane, i) => {
    if (!isStepModParam(lane.param)) {
      throw new RangeError(`lanes[${i}].param ${String(lane.param)} is not a StepModParam`);
    }
    if (seen.has(lane.param)) throw new RangeError(`lanes[${i}].param ${lane.param} repeats`);
    seen.add(lane.param);
    if (!lane.values.every((v) => v >= -1 && v <= 1)) {
      throw new RangeError(`lanes[${i}].values must each be in [-1, 1]`);
    }
  });
}

/**
 * Per-step parameter modulation (windsor#17): the table of what a sequencer
 * step may push, one row per `StepModParam`, in slot order. A lane value `v`
 * is in -1..1 with 0 the patch's own setting, and a row turns it into the
 * value the voice plays, `clamp(base + v × span, min, max)` in the row's own
 * curve space (`voiceStepMod.ts`):
 *
 * - `linear`: `base + v × span`;
 * - `octaves`: `base × 2^(v × span)`, `span` in octaves (the cutoff);
 * - `log`: the knob's log curve, `base × (max / min)^(v × span)`, `span` a
 *   fraction of the knob's travel (the times).
 *
 * The bounds mirror the Parts tab's knobs (`patchKnobTables.ts` in the app)
 * and each span is about half its knob's travel. `slideKeeps` marks a row a
 * legato retarget cannot change on a sounding voice without a click: the
 * voice keeps the old step's offset there (decision 1).
 *
 * The note-on message carries one slot per row, this order (decision 7);
 * `voiceStepMod.ts` addresses the slots through the constants below, which
 * `stepModTables.test.ts` pins against the rows. Data only, like
 * `patchDefaults.ts`: it imports that module and nothing else, never touches
 * the worklet scope, and the main thread reads it through `index.ts`, so it
 * is on the generators' pure side (`generatorBoundary.test.ts`).
 */

import { FEEDBACK_RANGE, OPERATOR_COUNT, WIDTH_RANGE } from './patchDefaults';

/** How a row's span is applied: added, in octaves, or along the knob's log curve. */
type StepModCurve = 'linear' | 'octaves' | 'log';

/** The filter's rows, slots 0..3. */
const STEP_MOD_FILTER_ROWS = [
  { param: 'filter.envAmount', curve: 'linear', span: 6, min: -6, max: 6, slideKeeps: false },
  { param: 'filter.cutoff', curve: 'octaves', span: 4.5, min: 30, max: 18000, slideKeeps: false },
  { param: 'filter.resonance', curve: 'linear', span: 6, min: 0.5, max: 12, slideKeeps: false },
  {
    param: 'filter.env.decayTime',
    curve: 'log',
    span: 0.5,
    min: 0.001,
    max: 20,
    slideKeeps: false,
  },
] as const;

/**
 * Each operator's rows, by field under `ops.<i>`, in slot order. The decay
 * curve reshapes a segment already running and feedback is read per sample
 * with no ramp, so a slide keeps both.
 */
const STEP_MOD_OPERATOR_ROWS = [
  { field: 'level', curve: 'linear', span: 0.5, min: 0, max: 1, slideKeeps: false },
  { field: 'env.decayTime', curve: 'log', span: 0.5, min: 0.001, max: 20, slideKeeps: false },
  { field: 'env.decayCurve', curve: 'linear', span: 1, min: -1, max: 1, slideKeeps: true },
  {
    field: 'feedback',
    curve: 'linear',
    span: 1,
    min: FEEDBACK_RANGE.min,
    max: FEEDBACK_RANGE.max,
    slideKeeps: true,
  },
  {
    field: 'width',
    curve: 'linear',
    span: 0.5,
    min: WIDTH_RANGE.min,
    max: WIDTH_RANGE.max,
    slideKeeps: false,
  },
] as const;

type StepModOperatorField = (typeof STEP_MOD_OPERATOR_ROWS)[number]['field'];
type StepModOperator = 0 | 1 | 2 | 3;

/** A parameter a step lane may modulate: its patch path. */
type StepModParam =
  (typeof STEP_MOD_FILTER_ROWS)[number]['param'] | `ops.${StepModOperator}.${StepModOperatorField}`;

/** One row: the parameter, its curve, its span in that curve and its bounds. */
interface StepModRow {
  readonly param: StepModParam;
  readonly curve: StepModCurve;
  readonly span: number;
  readonly min: number;
  readonly max: number;
  readonly slideKeeps: boolean;
}

/** Every row, in slot order: the filter's, then operator A's five, B's, C's and D's. */
const STEP_MOD_TABLE: readonly StepModRow[] = [
  ...STEP_MOD_FILTER_ROWS,
  ...Array.from({ length: OPERATOR_COUNT }, (_, i) =>
    STEP_MOD_OPERATOR_ROWS.map(({ field, ...row }): StepModRow => ({
      param: `ops.${i as StepModOperator}.${field}`,
      ...row,
    })),
  ).flat(),
];

/** Every parameter, in slot order. */
const STEP_MOD_PARAMS: readonly StepModParam[] = STEP_MOD_TABLE.map((row) => row.param);

/** The length of a note-on's offset array: one slot per row. */
const STEP_MOD_SLOT_COUNT = STEP_MOD_TABLE.length;

/** The most lanes one sequencer carries (decision 4). */
const STEP_MOD_LANES_MAX = 4;

/** The filter's slots. */
const STEP_SLOT_ENV_AMOUNT = 0;
const STEP_SLOT_CUTOFF = 1;
const STEP_SLOT_RESONANCE = 2;
const STEP_SLOT_FILTER_DECAY = 3;

/** Operator `i`'s slots start at `STEP_SLOT_OP_BASE + i × STEP_SLOT_OP_STRIDE`. */
const STEP_SLOT_OP_BASE = STEP_MOD_FILTER_ROWS.length;
const STEP_SLOT_OP_STRIDE = STEP_MOD_OPERATOR_ROWS.length;

/** An operator's fields, offset from its first slot. */
const STEP_OP_LEVEL = 0;
const STEP_OP_DECAY = 1;
const STEP_OP_DECAY_CURVE = 2;
const STEP_OP_FEEDBACK = 3;
const STEP_OP_WIDTH = 4;

export type { StepModCurve, StepModParam, StepModRow };
export {
  STEP_MOD_LANES_MAX,
  STEP_MOD_PARAMS,
  STEP_MOD_SLOT_COUNT,
  STEP_MOD_TABLE,
  STEP_OP_DECAY,
  STEP_OP_DECAY_CURVE,
  STEP_OP_FEEDBACK,
  STEP_OP_LEVEL,
  STEP_OP_WIDTH,
  STEP_SLOT_CUTOFF,
  STEP_SLOT_ENV_AMOUNT,
  STEP_SLOT_FILTER_DECAY,
  STEP_SLOT_OP_BASE,
  STEP_SLOT_OP_STRIDE,
  STEP_SLOT_RESONANCE,
};

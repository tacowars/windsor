/**
 * The voice's modulation targets (windsor#419, record
 * `2026-10-02-one-voice-target-table`): one row per value a source may move
 * on a sounding voice, in code order. The row's index is its target code
 * everywhere: a song lane's slot maps to it, a note-on's step array carries
 * one value per row in this order, and the voice keeps its `ownValues` and
 * `liveValues` by it (`voiceTargets.ts`). Today's sources are a song's
 * automation lanes (windsor#346) and a sequencer's step lanes (windsor#17);
 * a later source addresses the same codes.
 *
 * A row carries the target's patch path, its curve, its bounds, the floor a
 * ratio is taken from, a step's span and whether a slide keeps it:
 *
 * - `add`: `base + offset`;
 * - `ratio`: `max(base, floor) × 2^offset`, the offset in octaves. A decay
 *   time's knob ends on exact 0, which no ratio scales, so its ratio is taken
 *   from its 1 ms floor (windsor#347); an LFO rate a patch sets to 0 is
 *   taken from the knob's 0.02 Hz bottom the same way (windsor#419);
 *
 * then clamped to `min..max`. An offset of exactly 0 leaves the base as it
 * is, neither clamped nor floored. A step value `v` in -1..1 is the offset
 * `v × span` in the row's own curve, so a ratio row's span is in octaves; a
 * span is about half the knob's travel. `slideKeeps` marks a row a legato
 * retarget cannot change on a sounding voice without a click: the voice
 * keeps the old step's offset there.
 *
 * The bounds are the Parts tab's knobs, the patch's own ranges where it
 * clamps (`patchDefaults.ts`). Display data (label, scale, unit) is not here:
 * the automation catalog (`automation/automationTargetTables.ts`) and the
 * app's step-lane labels key it by path, and their parity tests keep them in
 * step with these rows.
 *
 * Adding a target: a row here, its look and label in the catalog and the
 * app, its field in `layoutVoiceTargets` (`voiceTargets.ts`), and a read of
 * `liveValues` at its application point.
 *
 * Data only: it imports `patchDefaults.ts` and nothing else, never touches
 * the worklet scope, and the main thread reads it through `index.ts`, so it
 * is on the generators' pure side (`generatorBoundary.test.ts`).
 * `voiceTargetTables.test.ts` pins the codes against the rows.
 */

import { FEEDBACK_RANGE, OPERATOR_COUNT, VOWEL_RANGE, WIDTH_RANGE } from './patchDefaults';

/** How an offset meets its base: added, or a ratio in octaves over the base raised to the floor. */
type VoiceTargetCurve = 'add' | 'ratio';

/** A decay time's floor and bottom: the 1 ms its ratio is taken from. */
const DECAY_FLOOR = 0.001;
/** A decay time's top, the knob's. */
const DECAY_MAX = 20;
/** Half a log knob's travel, in octaves: a step span on a ratio row. */
const halfTravel = (min: number, max: number): number => 0.5 * Math.log2(max / min);

/** The filter's rows: the Formant vowel last (windsor#406). */
const VOICE_TARGET_FILTER_ROWS = [
  { path: 'filter.cutoff', curve: 'ratio', min: 30, max: 18000, floor: 0, span: 4.5 },
  { path: 'filter.envAmount', curve: 'add', min: -6, max: 6, floor: 0, span: 6 },
  { path: 'filter.resonance', curve: 'add', min: 0.5, max: 12, floor: 0, span: 6 },
  {
    path: 'filter.env.decayTime',
    curve: 'ratio',
    min: DECAY_FLOOR,
    max: DECAY_MAX,
    floor: DECAY_FLOOR,
    span: halfTravel(DECAY_FLOOR, DECAY_MAX),
  },
  {
    path: 'filter.vowel',
    curve: 'add',
    min: VOWEL_RANGE.min,
    max: VOWEL_RANGE.max,
    floor: 0,
    span: 2,
  },
] as const;

/**
 * Each operator's rows, by field under `ops.<i>`. The decay curve reshapes a
 * segment already running and feedback is read per sample, so a slide keeps
 * both.
 */
const VOICE_TARGET_OPERATOR_ROWS = [
  { field: 'level', curve: 'add', min: 0, max: 1, floor: 0, span: 0.5, slideKeeps: false },
  {
    field: 'env.decayTime',
    curve: 'ratio',
    min: DECAY_FLOOR,
    max: DECAY_MAX,
    floor: DECAY_FLOOR,
    span: halfTravel(DECAY_FLOOR, DECAY_MAX),
    slideKeeps: false,
  },
  { field: 'env.decayCurve', curve: 'add', min: -1, max: 1, floor: 0, span: 1, slideKeeps: true },
  {
    field: 'feedback',
    curve: 'add',
    min: FEEDBACK_RANGE.min,
    max: FEEDBACK_RANGE.max,
    floor: 0,
    span: 1,
    slideKeeps: true,
  },
  {
    field: 'width',
    curve: 'add',
    min: WIDTH_RANGE.min,
    max: WIDTH_RANGE.max,
    floor: 0,
    span: 0.5,
    slideKeeps: false,
  },
] as const;

/** The LFO rate knob's ends; the bottom is also its floor, so a ratio over a patch rate of 0 scales from it. */
const LFO_RATE_MIN = 0.02;
const LFO_RATE_MAX = 40;

/** The LFOs' and the pitch envelope's rows, after the operators'. */
const VOICE_TARGET_MOD_ROWS = [
  { path: 'lfo.amount', curve: 'add', min: 0, max: 1, floor: 0, span: 0.5 },
  {
    path: 'lfo.rate',
    curve: 'ratio',
    min: LFO_RATE_MIN,
    max: LFO_RATE_MAX,
    floor: LFO_RATE_MIN,
    span: halfTravel(LFO_RATE_MIN, LFO_RATE_MAX),
  },
  { path: 'lfo2.amount', curve: 'add', min: 0, max: 1, floor: 0, span: 0.5 },
  {
    path: 'lfo2.rate',
    curve: 'ratio',
    min: LFO_RATE_MIN,
    max: LFO_RATE_MAX,
    floor: LFO_RATE_MIN,
    span: halfTravel(LFO_RATE_MIN, LFO_RATE_MAX),
  },
  { path: 'pitchEnvAmount', curve: 'add', min: -48, max: 48, floor: 0, span: 48 },
] as const;

type VoiceTargetOperatorField = (typeof VOICE_TARGET_OPERATOR_ROWS)[number]['field'];
type VoiceTargetOperator = 0 | 1 | 2 | 3;

/** A target's patch path: what a song lane and a step lane name. */
type VoiceTargetPath =
  | (typeof VOICE_TARGET_FILTER_ROWS)[number]['path']
  | `ops.${VoiceTargetOperator}.${VoiceTargetOperatorField}`
  | (typeof VOICE_TARGET_MOD_ROWS)[number]['path'];

/** One target: its path, its curve, its bounds, its ratio floor, a step's span, and whether a slide keeps it. */
interface VoiceTargetRow {
  readonly path: VoiceTargetPath;
  readonly curve: VoiceTargetCurve;
  readonly min: number;
  readonly max: number;
  readonly floor: number;
  readonly span: number;
  readonly slideKeeps: boolean;
}

/** Every row, in code order: the filter's five, operator A's five, B's, C's and D's, then the LFOs' and the pitch envelope's. */
const VOICE_TARGET_TABLE: readonly VoiceTargetRow[] = [
  ...VOICE_TARGET_FILTER_ROWS.map((row): VoiceTargetRow => ({ ...row, slideKeeps: false })),
  ...Array.from({ length: OPERATOR_COUNT }, (_, i) =>
    VOICE_TARGET_OPERATOR_ROWS.map(({ field, ...row }): VoiceTargetRow => ({
      path: `ops.${i as VoiceTargetOperator}.${field}`,
      ...row,
    })),
  ).flat(),
  ...VOICE_TARGET_MOD_ROWS.map((row): VoiceTargetRow => ({ ...row, slideKeeps: false })),
];

/** Every path, in code order. */
const VOICE_TARGET_PATHS: readonly VoiceTargetPath[] = VOICE_TARGET_TABLE.map((row) => row.path);

/** The number of targets: the length of a note-on's step array and of the voice's arrays. */
const VOICE_TARGET_COUNT = VOICE_TARGET_TABLE.length;

/** The filter's codes. */
const VT_CUTOFF = 0;
const VT_ENV_AMOUNT = 1;
const VT_RESONANCE = 2;
const VT_FILTER_DECAY = 3;
const VT_VOWEL = 4;
/** Operator `i`'s codes start at `VT_OP_BASE + i × VT_OP_STRIDE`. */
const VT_OP_BASE = VOICE_TARGET_FILTER_ROWS.length;
const VT_OP_STRIDE = VOICE_TARGET_OPERATOR_ROWS.length;
/** An operator's fields, offset from its first code. */
const VT_OP_LEVEL = 0;
const VT_OP_DECAY = 1;
const VT_OP_DECAY_CURVE = 2;
const VT_OP_FEEDBACK = 3;
const VT_OP_WIDTH = 4;
/** The LFOs' and the pitch envelope's codes. */
const VT_LFO_AMOUNT = VT_OP_BASE + OPERATOR_COUNT * VT_OP_STRIDE;
const VT_LFO_RATE = VT_LFO_AMOUNT + 1;
const VT_LFO2_AMOUNT = VT_LFO_AMOUNT + 2;
const VT_LFO2_RATE = VT_LFO_AMOUNT + 3;
const VT_PITCH_ENV_AMOUNT = VT_LFO_AMOUNT + 4;

/** The rows by code, as typed arrays the voice indexes: 1 for a ratio row, its bounds, floor, span and slide. */
const VOICE_TARGET_RATIO = Uint8Array.from(VOICE_TARGET_TABLE, (row) =>
  row.curve === 'ratio' ? 1 : 0,
);
const VOICE_TARGET_MIN = Float64Array.from(VOICE_TARGET_TABLE, (row) => row.min);
const VOICE_TARGET_MAX = Float64Array.from(VOICE_TARGET_TABLE, (row) => row.max);
const VOICE_TARGET_FLOOR = Float64Array.from(VOICE_TARGET_TABLE, (row) => row.floor);
const VOICE_TARGET_SPAN = Float64Array.from(VOICE_TARGET_TABLE, (row) => row.span);
const VOICE_TARGET_SLIDE_KEEPS = Uint8Array.from(VOICE_TARGET_TABLE, (row) =>
  row.slideKeeps ? 1 : 0,
);

/** The code of the target at `path`, or -1 for none. Read at a message, never in the render. */
function voiceTargetCode(path: unknown): number {
  return typeof path === 'string' ? (VOICE_TARGET_PATHS as readonly string[]).indexOf(path) : -1;
}

/** The row of the target at `path`, or undefined for none: the table's own row, so nothing is allocated. */
function voiceTargetRow(path: unknown): VoiceTargetRow | undefined {
  const code = voiceTargetCode(path);
  return code < 0 ? undefined : VOICE_TARGET_TABLE[code];
}

export type { VoiceTargetCurve, VoiceTargetPath, VoiceTargetRow };
export {
  VOICE_TARGET_COUNT,
  VOICE_TARGET_FLOOR,
  VOICE_TARGET_MAX,
  VOICE_TARGET_MIN,
  VOICE_TARGET_PATHS,
  VOICE_TARGET_RATIO,
  VOICE_TARGET_SLIDE_KEEPS,
  VOICE_TARGET_SPAN,
  VOICE_TARGET_TABLE,
  VT_CUTOFF,
  VT_ENV_AMOUNT,
  VT_FILTER_DECAY,
  VT_LFO2_AMOUNT,
  VT_LFO2_RATE,
  VT_LFO_AMOUNT,
  VT_LFO_RATE,
  VT_OP_BASE,
  VT_OP_DECAY,
  VT_OP_DECAY_CURVE,
  VT_OP_FEEDBACK,
  VT_OP_LEVEL,
  VT_OP_STRIDE,
  VT_OP_WIDTH,
  VT_PITCH_ENV_AMOUNT,
  VT_RESONANCE,
  VT_VOWEL,
  voiceTargetCode,
  voiceTargetRow,
};

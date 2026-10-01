/**
 * The voice targets a song's automation lanes move on ringing voices
 * (windsor#346, record `2026-10-01-song-automation-lanes` decisions 7, 10 and
 * 16), as data: one row per target the part's slots can carry, in target
 * code order, with how its offset meets the value the voice plays and the
 * bounds the result is clamped to.
 *
 * - A part has `VOICE_SLOT_COUNT` k-rate parameters (`VOICE_SLOT_PARAMS`),
 *   eight as windsor#343 measured (`FM_LANES_MAX` on the main thread). Each
 *   slot is mapped to one target by its patch path, at construction
 *   (`ProcessorOptions.voiceSlots`) and by a `voiceSlots` message; a slot
 *   maps to a code here.
 * - The main thread sends an offset from the patch's value (decision 10):
 *   added for most rows, a log2 ratio for the LFO rates (`OFFSET_RATIO`).
 *   The filter's cutoff is not here: its lane writes the part's `cutoffMod`.
 * - The nine decay rows are windsor#347's and not here either.
 *
 * The bounds are the catalog's (`automation/automationTargetTables.ts`): the
 * step-mod rows' from `STEP_MOD_TABLE`, the LFO and pitch-envelope rows' the
 * Parts tab's knobs. `voiceOffsetTables.test.ts` pins every row against the
 * catalog. Data only, imports two data modules, never touches the worklet
 * scope; `voiceOffsets.ts` is the logic over it.
 */

import { OPERATOR_COUNT } from './patchDefaults';
import { STEP_MOD_TABLE } from './stepModTables';

/** How an offset meets its base: added, or as a log2 ratio, `base × 2^offset`. */
const OFFSET_ADD = 0;
const OFFSET_RATIO = 1;

/** The automation slots on one part: its k-rate parameters, each mapped to one target. */
const VOICE_SLOT_COUNT = 8;

/** Each slot's parameter name, by slot: literals, so the render reads them without building a string. */
const VOICE_SLOT_PARAMS: readonly string[] = [
  'voiceSlot0',
  'voiceSlot1',
  'voiceSlot2',
  'voiceSlot3',
  'voiceSlot4',
  'voiceSlot5',
  'voiceSlot6',
  'voiceSlot7',
];

/** The filter's two rows. */
const VT_ENV_AMOUNT = 0;
const VT_RESONANCE = 1;
/** Operator `i`'s rows start at `VT_OP_BASE + i × VT_OP_STRIDE`. */
const VT_OP_BASE = 2;
const VT_OP_STRIDE = 3;
/** An operator's rows, offset from its first. */
const VT_OP_LEVEL = 0;
const VT_OP_FEEDBACK = 1;
const VT_OP_WIDTH = 2;
/** The LFOs' and the pitch envelope's rows, after the operators'. */
const VT_LFO_AMOUNT = VT_OP_BASE + OPERATOR_COUNT * VT_OP_STRIDE;
const VT_LFO_RATE = VT_LFO_AMOUNT + 1;
const VT_LFO2_AMOUNT = VT_LFO_AMOUNT + 2;
const VT_LFO2_RATE = VT_LFO_AMOUNT + 3;
const VT_PITCH_ENV_AMOUNT = VT_LFO_AMOUNT + 4;
const VOICE_TARGET_COUNT = VT_LFO_AMOUNT + 5;

/** The bounds of the rows the step-mod table does not carry: the Parts tab's knobs. */
const LFO_AMOUNT_BOUNDS = { min: 0, max: 1 };
const LFO_RATE_BOUNDS = { min: 0.02, max: 40 };
const PITCH_ENV_AMOUNT_BOUNDS = { min: -48, max: 48 };

/** One target: its patch path, how its offset applies, and its bounds. */
interface VoiceOffsetRow {
  readonly path: string;
  readonly curve: number;
  readonly min: number;
  readonly max: number;
}

/** A step-mod row's bounds, by its patch path. */
function stepModBounds(path: string): { min: number; max: number } {
  for (const row of STEP_MOD_TABLE) if (row.param === path) return { min: row.min, max: row.max };
  throw new Error(`voiceOffsetTables: no step-mod row for ${path}`);
}

/** Every row, in code order. */
const VOICE_OFFSET_TABLE: readonly VoiceOffsetRow[] = [
  { path: 'filter.envAmount', curve: OFFSET_ADD, ...stepModBounds('filter.envAmount') },
  { path: 'filter.resonance', curve: OFFSET_ADD, ...stepModBounds('filter.resonance') },
  ...Array.from({ length: OPERATOR_COUNT }, (_, i) => [
    { path: `ops.${i}.level`, curve: OFFSET_ADD, ...stepModBounds(`ops.${i}.level`) },
    { path: `ops.${i}.feedback`, curve: OFFSET_ADD, ...stepModBounds(`ops.${i}.feedback`) },
    { path: `ops.${i}.width`, curve: OFFSET_ADD, ...stepModBounds(`ops.${i}.width`) },
  ]).flat(),
  { path: 'lfo.amount', curve: OFFSET_ADD, ...LFO_AMOUNT_BOUNDS },
  { path: 'lfo.rate', curve: OFFSET_RATIO, ...LFO_RATE_BOUNDS },
  { path: 'lfo2.amount', curve: OFFSET_ADD, ...LFO_AMOUNT_BOUNDS },
  { path: 'lfo2.rate', curve: OFFSET_RATIO, ...LFO_RATE_BOUNDS },
  { path: 'pitchEnvAmount', curve: OFFSET_ADD, ...PITCH_ENV_AMOUNT_BOUNDS },
];

/** The rows' curves and bounds by code, as typed arrays the control update indexes. */
const VOICE_OFFSET_CURVE = Int32Array.from(VOICE_OFFSET_TABLE, (row) => row.curve);
const VOICE_OFFSET_MIN = Float64Array.from(VOICE_OFFSET_TABLE, (row) => row.min);
const VOICE_OFFSET_MAX = Float64Array.from(VOICE_OFFSET_TABLE, (row) => row.max);

/** The code of the target at `path`, or -1 when no slot can carry it. Read at a message, never in the render. */
function voiceTargetCode(path: unknown): number {
  if (typeof path !== 'string') return -1;
  for (let k = 0; k < VOICE_OFFSET_TABLE.length; k++) {
    if (VOICE_OFFSET_TABLE[k].path === path) return k;
  }
  return -1;
}

export type { VoiceOffsetRow };
export {
  OFFSET_ADD,
  OFFSET_RATIO,
  VOICE_OFFSET_CURVE,
  VOICE_OFFSET_MAX,
  VOICE_OFFSET_MIN,
  VOICE_OFFSET_TABLE,
  VOICE_SLOT_COUNT,
  VOICE_SLOT_PARAMS,
  VOICE_TARGET_COUNT,
  VT_ENV_AMOUNT,
  VT_LFO2_AMOUNT,
  VT_LFO2_RATE,
  VT_LFO_AMOUNT,
  VT_LFO_RATE,
  VT_OP_BASE,
  VT_OP_FEEDBACK,
  VT_OP_LEVEL,
  VT_OP_STRIDE,
  VT_OP_WIDTH,
  VT_PITCH_ENV_AMOUNT,
  VT_RESONANCE,
  voiceTargetCode,
};

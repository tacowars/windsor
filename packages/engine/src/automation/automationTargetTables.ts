/**
 * The automation catalog's strip and voice rows (windsor#341, record
 * `2026-10-01-song-automation-lanes` decisions 2–5), as data. The insert rows
 * are `automationInsertTables.ts`; the lookups are `automationTargets.ts`.
 *
 * Every row's bounds and scale are its knob's: the voice rows take the
 * bounds `STEP_MOD_TABLE` holds and the five fields it lacks take the Parts
 * tab's, and the app's `automationTargetParity.test.ts` holds every voice and
 * strip row to its knob (`patchKnobTables.ts`, `mixerTables.ts`). A lane is
 * drawn in its knob's own scale (decision 5), so a decay time, whose knob
 * ends on exact 0 (windsor#316), is a log row from 0 with the step-mod
 * table's 1 ms as its display floor.
 */
import { OP_NAMES } from '../patch/patch';
import { STEP_MOD_TABLE, type StepModParam } from '../worklet/fm/stepModTables';
import type { AutomationScale, AutomationTargetRow, StripTargetId } from './automationLane';

/** The most FM lanes one part carries (decision 3). Strip and insert lanes have no cap. */
export const FM_LANES_MAX = 8;

/** The level lane's floor, in dB: the bottom of the lane, where the fader reads −∞. */
export const AUTOMATION_LEVEL_FLOOR_DB = -60;

/** Decibels per decade of linear gain. */
const DB_PER_DECADE = 20;

/**
 * The level lane's top: the Song tab's Level knob (`STRIP_LEVEL_MAX` in the
 * app's `mixerTables.ts`, +6 dB), which the lane locks and lights. The song
 * format clamps a strip's level to `MIX_LEVEL_MAX` (+12 dB); a lane stays
 * inside what its knob can show.
 */
export const AUTOMATION_STRIP_LEVEL_MAX = 2;

/** A send's range, as `deskNormalise.ts` clamps it. */
const SEND_RANGE = { min: 0, max: 1 } as const;

/** The strip's four rows. */
export const STRIP_AUTOMATION_ROWS: readonly (AutomationTargetRow & {
  readonly target: StripTargetId;
})[] = [
  {
    target: 'strip.level',
    label: 'Level',
    min: 0,
    max: AUTOMATION_STRIP_LEVEL_MAX,
    scale: 'db',
    unit: 'dB',
    floor: 10 ** (AUTOMATION_LEVEL_FLOOR_DB / DB_PER_DECADE),
  },
  { target: 'strip.pan', label: 'Pan', min: -1, max: 1, scale: 'linear', unit: '' },
  { target: 'strip.send.a', label: 'Send A', ...SEND_RANGE, scale: 'linear', unit: '' },
  { target: 'strip.send.b', label: 'Send B', ...SEND_RANGE, scale: 'linear', unit: '' },
];

/** How a step-mod parameter reads as a lane: its label, its knob's scale, its unit. */
interface VoiceLook {
  readonly label: string;
  readonly scale: AutomationScale;
  readonly unit: string;
  /** The knob ends on exact 0: the row's `min` is 0 and the step-mod minimum is its floor. */
  readonly zeroEnd?: boolean;
}

const FILTER_LOOKS: readonly (readonly [StepModParam, VoiceLook])[] = [
  ['filter.cutoff', { label: 'Cutoff', scale: 'octaves', unit: 'Hz' }],
  ['filter.envAmount', { label: 'Filter env amount', scale: 'linear', unit: 'oct' }],
  ['filter.resonance', { label: 'Resonance', scale: 'log', unit: '' }],
  ['filter.env.decayTime', { label: 'Filter env decay', scale: 'log', unit: 's', zeroEnd: true }],
];

/** An operator's five step-mod fields, under `ops.<i>`. */
const OPERATOR_LOOKS: readonly (readonly [string, VoiceLook])[] = [
  ['level', { label: 'level', scale: 'linear', unit: '' }],
  ['env.decayTime', { label: 'decay', scale: 'log', unit: 's', zeroEnd: true }],
  ['env.decayCurve', { label: 'decay curve', scale: 'linear', unit: '' }],
  ['feedback', { label: 'feedback', scale: 'linear', unit: '' }],
  ['width', { label: 'width', scale: 'linear', unit: '' }],
];

/**
 * The five voice fields the step-mod table does not carry. The patch
 * normaliser does not clamp them, so their bounds are the Parts tab's knobs.
 */
const LFO_AMOUNT_RANGE = { min: 0, max: 1 } as const;
const LFO_RATE_RANGE = { min: 0.02, max: 40 } as const;
const PITCH_ENV_AMOUNT_RANGE = { min: -48, max: 48 } as const;

/** A voice row from its step-mod row's bounds. */
function stepModRow(param: StepModParam, look: VoiceLook, label = look.label): AutomationTargetRow {
  const row = STEP_MOD_TABLE.find((r) => r.param === param);
  if (!row) throw new Error(`automationTargetTables: no step-mod row for ${param}`);
  const { scale, unit } = look;
  const bounds = look.zeroEnd
    ? { min: 0, max: row.max, floor: row.min }
    : { min: row.min, max: row.max };
  return { target: `voice.${param}`, label, ...bounds, scale, unit };
}

/** LFO 1's and LFO 2's amount and rate. */
function lfoRows(): AutomationTargetRow[] {
  return (['lfo', 'lfo2'] as const).flatMap((key, i) => {
    const name = `LFO ${i + 1}`;
    return [
      {
        target: `voice.${key}.amount`,
        label: `${name} amount`,
        ...LFO_AMOUNT_RANGE,
        scale: 'linear',
        unit: '',
      },
      {
        target: `voice.${key}.rate`,
        label: `${name} rate`,
        ...LFO_RATE_RANGE,
        scale: 'log',
        unit: 'Hz',
      },
    ] satisfies AutomationTargetRow[];
  });
}

/**
 * The voice's 29 rows (decision 2): the filter's four, each operator's five,
 * LFO 1 and LFO 2 amount and rate, and the pitch-envelope amount.
 */
export const VOICE_AUTOMATION_ROWS: readonly AutomationTargetRow[] = [
  ...FILTER_LOOKS.map(([param, look]) => stepModRow(param, look)),
  ...OP_NAMES.flatMap((name, i) =>
    OPERATOR_LOOKS.map(([field, look]) =>
      stepModRow(`ops.${i}.${field}` as StepModParam, look, `Op ${name} ${look.label}`),
    ),
  ),
  ...lfoRows(),
  {
    target: 'voice.pitchEnvAmount',
    label: 'Pitch env amount',
    ...PITCH_ENV_AMOUNT_RANGE,
    scale: 'linear',
    unit: 'st',
  },
];

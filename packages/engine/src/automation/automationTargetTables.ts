/**
 * The automation catalog's strip and voice rows (windsor#341, record
 * `2026-10-01-song-automation-lanes` decisions 2–5), as data. The insert rows
 * are `automationInsertTables.ts`; the lookups are `automationTargets.ts`.
 *
 * Every row's bounds and scale are its knob's: the voice rows are the voice
 * target table's (`worklet/fm/voiceTargetTables.ts`, windsor#419), one per
 * row with its bounds, and this file adds each one's look (label, scale,
 * unit) by path, the one place a voice target is named (windsor#424);
 * `automationTargets.ts` puts each look under its target id as
 * `VOICE_AUTOMATION_ROWS`. The app's `automationTargetParity.test.ts` holds every
 * voice and strip row to its knob (`patchKnobTables.ts`, `mixerTables.ts`).
 * A lane is drawn in its knob's own scale (decision 5), so a decay time,
 * whose knob ends on exact 0 (windsor#316), is a log row from 0 with the
 * table's 1 ms floor as its display floor.
 */
import { OP_NAMES } from '../patch/patch';
import type { VoiceTargetPath, VoiceTargetRow } from '../worklet/fm/voiceTargetTables';
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

/** How a voice target reads as a lane: its label, its knob's scale, its unit. */
interface VoiceLook {
  readonly label: string;
  readonly scale: AutomationScale;
  readonly unit: string;
  /** The knob ends on exact 0: the lane's `min` is 0 and the table row's floor is its display floor. */
  readonly zeroEnd?: boolean;
}

/** An operator's target, `ops.<i>.<field>`. */
type OperatorPath = Extract<VoiceTargetPath, `ops.${string}`>;
/** Every other target: the filter's, the LFOs' and the pitch envelope's. */
type VoicePath = Exclude<VoiceTargetPath, OperatorPath>;
/** The field an operator path names, `env.decayTime` of `ops.2.env.decayTime`. */
type FieldOf<P> = P extends `ops.${number}.${infer F}` ? F : never;
/** An operator's five fields. */
type OperatorField = FieldOf<OperatorPath>;

/**
 * The filter's, the LFOs' and the pitch envelope's looks, by path, keyed by
 * the target table's own path type so a target with no look fails
 * typecheck. A label is the target's one name (windsor#424): the song-lane
 * picker, a lane's mixer cell and a step lane all show it, so it fits a step
 * lane's narrow header.
 */
const VOICE_LOOKS: Readonly<Record<VoicePath, VoiceLook>> = {
  'filter.cutoff': { label: 'Cutoff', scale: 'octaves', unit: 'Hz' },
  'filter.envAmount': { label: 'Filt Env Amt', scale: 'linear', unit: 'oct' },
  'filter.resonance': { label: 'Resonance', scale: 'log', unit: '' },
  'filter.env.decayTime': { label: 'Filter Decay', scale: 'log', unit: 's', zeroEnd: true },
  // The Formant mode's vowel (windsor#406): the picker lists it whatever the
  // filter mode; a lane on a patch not in Formant is silent.
  'filter.vowel': { label: 'Vowel', scale: 'linear', unit: '' },
  'lfo.amount': { label: 'LFO 1 Amount', scale: 'linear', unit: '' },
  'lfo.rate': { label: 'LFO 1 Rate', scale: 'log', unit: 'Hz' },
  'lfo2.amount': { label: 'LFO 2 Amount', scale: 'linear', unit: '' },
  'lfo2.rate': { label: 'LFO 2 Rate', scale: 'log', unit: 'Hz' },
  pitchEnvAmount: { label: 'Pitch Env Amt', scale: 'linear', unit: 'st' },
};

/** An operator's five fields' looks, under `ops.<i>`; the label follows `Op <name> `. */
const OPERATOR_LOOKS: Readonly<Record<OperatorField, VoiceLook>> = {
  level: { label: 'Level', scale: 'linear', unit: '' },
  'env.decayTime': { label: 'Decay', scale: 'log', unit: 's', zeroEnd: true },
  'env.decayCurve': { label: 'Decay Crv', scale: 'linear', unit: '' },
  feedback: { label: 'Feedback', scale: 'linear', unit: '' },
  width: { label: 'Width', scale: 'linear', unit: '' },
};

/** An operator's path: its index and its field. */
const OPERATOR_PATH = /^ops\.(\d)\.(.+)$/;

/** The look of the target at `path`, an operator's labelled with its name. */
function lookOf(path: VoiceTargetPath): VoiceLook {
  const op = OPERATOR_PATH.exec(path);
  if (!op) return VOICE_LOOKS[path as VoicePath];
  const look = OPERATOR_LOOKS[op[2] as OperatorField];
  return { ...look, label: `Op ${OP_NAMES[Number(op[1])]} ${look.label}` };
}

/** A voice row without its target id: its target row's bounds and its look. */
export function voiceRowLook(row: VoiceTargetRow): Omit<AutomationTargetRow, 'target'> {
  const { label, scale, unit, zeroEnd } = lookOf(row.path);
  const bounds = zeroEnd
    ? { min: 0, max: row.max, floor: row.floor }
    : { min: row.min, max: row.max };
  return { label, ...bounds, scale, unit };
}

/**
 * The Mixer tab's knob specs (#618): the strips over `DEFAULT_STRIP`, the
 * groups over `DEFAULT_GROUP` (windsor#287), the send buses' names, and the plate and delay line's own ranges and tempo
 * divisions. The plate's ranges are the worklet's (`REVERB_SPACE_RANGES`);
 * the delay's are here.
 *
 * A strip knob that a song lane moves (level, pan, the sends) takes its
 * `min` and `max` from the automation catalog's strip row (windsor#443,
 * record `2026-10-02-knob-ranges-from-the-catalog`), so the knob and the
 * lane that locks it cannot disagree. Only the bounds: the Level knob is
 * linear in gain while its lane is drawn in dB.
 */
import type { AutomationTargetId, ReturnName } from '@windsor/engine';
import {
  AUTOMATION_STRIP_LEVEL_MAX,
  DEFAULT_GROUP,
  DEFAULT_STRIP,
  LOW_CUT_MAX_HZ,
  LOW_CUT_MIN_HZ,
  catalogRow,
  formatTargetId,
} from '@windsor/engine';
import { fmt2, fmtHz, fmtSigned } from './consoleFormat';
import type { CardKnobSpec } from './sequencerKnobTables';

/** The `min` and `max` of a strip target's catalog row. Throws on a target the catalog has no row for. */
function stripRange(target: AutomationTargetId): { readonly min: number; readonly max: number } {
  const row = catalogRow(target);
  if (!row) throw new Error(`mixerTables: no strip row for ${target}`);
  return { min: row.min, max: row.max };
}

/** A strip's level reaches +6 dB, the catalog's level row's top; the default is unity from the engine. */
export const STRIP_LEVEL_MAX = AUTOMATION_STRIP_LEVEL_MAX;
export const STRIP_LEVEL_KNOB: CardKnobSpec = {
  label: 'Level',
  ...stripRange('strip.level'),
  def: DEFAULT_STRIP.level,
  fmt: fmt2,
};
export const STRIP_PAN_KNOB: CardKnobSpec = {
  label: 'Pan',
  ...stripRange('strip.pan'),
  def: DEFAULT_STRIP.pan,
  fmt: fmtSigned,
};
/**
 * The strip's low cut (#640), on a log curve like every frequency knob here.
 * The range and the default are the engine's, so the floor reads as off.
 */
export const STRIP_LOW_CUT_KNOB: CardKnobSpec = {
  label: 'Low cut',
  min: LOW_CUT_MIN_HZ,
  max: LOW_CUT_MAX_HZ,
  def: DEFAULT_STRIP.lowCut,
  curve: 'log',
  fmt: fmtHz,
};
/** A group's fader (windsor#287): a strip's range, unity by default from the engine. */
export const GROUP_LEVEL_KNOB: CardKnobSpec = { ...STRIP_LEVEL_KNOB, def: DEFAULT_GROUP.level };
/** A group's pan: a strip's range, centred by default from the engine. */
export const GROUP_PAN_KNOB: CardKnobSpec = { ...STRIP_PAN_KNOB, def: DEFAULT_GROUP.pan };
/** The send buses as the console names them (windsor#172). */
export const BUS_LABELS: Readonly<Record<ReturnName, string>> = { a: 'Send A', b: 'Send B' };
/** A send the strip does not name is silent. */
export const SEND_DEFAULT = 0;
/** A part's send to one bus, labelled with the bus's letter: `→ A`, `→ B`. */
export const sendKnob = (ret: string): CardKnobSpec => ({
  label: `→ ${ret.toUpperCase()}`,
  ...stripRange(formatTargetId({ kind: 'strip', field: `send.${ret}` })),
  def: DEFAULT_STRIP.sends[ret] ?? SEND_DEFAULT,
  fmt: fmt2,
});

/** The shortest delay the knob reaches; below this the line is a comb filter, not an echo. */
export const DELAY_TIME_MIN = 0.02;
/** The delay's damping filter, in Hz. */
export const DAMP_MIN = 200;
export const DAMP_MAX = 16000;
/** A tempo button reads pressed when the stored time is within this of its value, in seconds. */
export const TEMPO_MATCH_TOLERANCE = 1e-6;

/** Note values as fractions of a beat (a quarter note), common echoes first. */
export const TEMPO_DIVISIONS: readonly { label: string; beats: number; title: string }[] = [
  { label: '1/4', beats: 1, title: 'quarter note' },
  { label: '1/8.', beats: 0.75, title: 'dotted eighth' },
  { label: '1/8', beats: 0.5, title: 'eighth note' },
  { label: '1/8T', beats: 1 / 3, title: 'eighth triplet' },
  { label: '1/16', beats: 0.25, title: 'sixteenth note' },
  { label: '1/16.', beats: 0.375, title: 'dotted sixteenth' },
  { label: '1/4.', beats: 1.5, title: 'dotted quarter' },
  { label: '1/2', beats: 2, title: 'half note' },
];

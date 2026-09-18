/**
 * The Mixer tab's knob specs (#618): the strips over `DEFAULT_STRIP`, and the
 * returns' own ranges and tempo divisions. The plate's ranges are the
 * worklet's (`REVERB_SPACE_RANGES`); the delay's are here.
 */
import { DEFAULT_STRIP } from '../../../packages/client/src/audio/index-for-editor';
import { fmt2, fmtSigned } from './consoleFormat';
import type { CardKnobSpec } from './sequencerKnobTables';

/** A strip's level reaches +6 dB; the default is unity from the engine. */
export const STRIP_LEVEL_MAX = 2;
export const STRIP_LEVEL_KNOB: CardKnobSpec = {
  label: 'Level',
  min: 0,
  max: STRIP_LEVEL_MAX,
  def: DEFAULT_STRIP.level,
  fmt: fmt2,
};
export const STRIP_PAN_KNOB: CardKnobSpec = {
  label: 'Pan',
  min: -1,
  max: 1,
  def: DEFAULT_STRIP.pan,
  fmt: fmtSigned,
};
/** A send the strip does not name is silent. */
export const SEND_DEFAULT = 0;
export const sendKnob = (ret: string): CardKnobSpec => ({
  label: `→ ${ret}`,
  min: 0,
  max: 1,
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

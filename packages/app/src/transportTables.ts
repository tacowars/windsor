/**
 * The transport strip's tables (#708, epic #703 decision 1): the two knobs'
 * ranges, the key and scale options, and the position readout's grid. Every
 * value is the engine's or the new song's; nothing is restated.
 */
import {
  BARS_MAX,
  BARS_MIN,
  BPM_MAX,
  BPM_MIN,
  CHORD_NOTE_NAMES,
  PITCH_CLASS_MAX,
  PPQ,
  SCALE_NAMES,
  TICKS_PER_BAR,
} from '@windsor/engine';
import { fmt0 } from './consoleFormat';
import type { KnobSpec } from './knob';
import { NEW_SONG_BARS, NEW_SONG_BPM } from './songConstants';

type KnobRange = Pick<KnobSpec, 'label' | 'min' | 'max' | 'def' | 'step' | 'fmt'>;

/** The tempo knob: the engine's range, and what a new song starts at (#617). */
export const BPM_KNOB: KnobRange = {
  label: 'BPM',
  min: BPM_MIN,
  max: BPM_MAX,
  def: NEW_SONG_BPM,
  step: 1,
  fmt: fmt0,
};

/** The song's length in bars (#705, decision 5): the engine's range, and what a new song starts at. */
export const BARS_KNOB: KnobRange = {
  label: 'Bars',
  min: BARS_MIN,
  max: BARS_MAX,
  def: NEW_SONG_BARS,
  step: 1,
  fmt: fmt0,
};

/** 4/4 is the engine's constant (epic #703 decision 7): a readout, not a control. */
export const METER_LABEL = '4/4';

/** The twelve pitch classes, spelt as `chordNames.ts` prints them (sharps). */
export const KEY_OPTIONS: readonly { value: string; label: string }[] = CHORD_NOTE_NAMES.slice(
  0,
  PITCH_CLASS_MAX + 1,
).map((name, pc) => ({ value: String(pc), label: name }));

/** The named scales, in the engine's order; a custom offset list shows as this. */
export const CUSTOM_SCALE = 'custom';
export const SCALE_OPTIONS: readonly { value: string; label: string }[] = SCALE_NAMES.map(
  (name) => ({ value: name, label: name }),
);

/** The position readout's grid: ticks per bar, per beat and per sixteenth. */
export const SIXTEENTHS_PER_BEAT = 4;
export interface PositionGrid {
  readonly bar: number;
  readonly beat: number;
  readonly sixteenth: number;
}
export const POSITION_GRID: PositionGrid = {
  bar: TICKS_PER_BAR,
  beat: PPQ,
  sixteenth: PPQ / SIXTEENTHS_PER_BEAT,
};

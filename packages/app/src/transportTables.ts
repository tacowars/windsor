/**
 * The transport strip's tables (#708, epic #703 decision 1): the tempo and
 * bars boxes' ranges and drag feel (windsor#12), tap tempo, the key and scale
 * options, and the position readout's grid. Every range is the engine's or
 * the new song's; nothing is restated.
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
import { fmt0, fmt2 } from './consoleFormat';
import type { KnobSpec } from './knob';
import { DRAG_RANGE_FINE_PX, DRAG_RANGE_PX } from './knobConstants';
import { NEW_SONG_BARS, NEW_SONG_BPM } from './songConstants';

export type KnobRange = Pick<KnobSpec, 'label' | 'min' | 'max' | 'def' | 'step' | 'fmt'>;

/**
 * The tempo box: the engine's range, and what a new song starts at (#617).
 * Shown and stepped to two decimals, as Ableton Live's tempo field is
 * (windsor#12), so a typed 133.5 or a tapped tempo lands as it is, and a drag
 * sweeps smoothly.
 */
export const BPM_KNOB: KnobRange = {
  label: 'BPM',
  min: BPM_MIN,
  max: BPM_MAX,
  def: NEW_SONG_BPM,
  step: 0.01,
  fmt: fmt2,
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

/**
 * How a vertical drag on a number box moves it (windsor#12 decision 2): the
 * knob's sensitivity — `DRAG_RANGE_PX` of travel sweeps the whole range,
 * `DRAG_RANGE_FINE_PX` under shift — and the few pixels a press may wander
 * before it counts as a drag rather than a click to type.
 */
export interface DragFeel {
  readonly rangePx: number;
  readonly fineRangePx: number;
}
export const NUMBER_DRAG: DragFeel = { rangePx: DRAG_RANGE_PX, fineRangePx: DRAG_RANGE_FINE_PX };
export const NUMBER_DRAG_THRESHOLD_PX = 3;

/** A drag on Bars moves it in whole phrases of this many bars, snapping to multiples of it. */
export const BARS_DRAG_STEP = 4;

/**
 * Tap tempo (windsor#12 decision 4): the average of the last `intervals` tap
 * intervals, and a gap of `resetMs` or longer starts a new average.
 */
export interface TapTempo {
  readonly intervals: number;
  readonly resetMs: number;
}
export const TAP_TEMPO: TapTempo = { intervals: 4, resetMs: 2000 };
export const MS_PER_MINUTE = 60_000;

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

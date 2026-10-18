/**
 * The master column's Cue knob (windsor#907): the engine's aux fader, the
 * level of the chord audition and the metronome. Its range in linear gain,
 * silent at the bottom stop to +6 dB at the top, on a log sweep (even in dB)
 * from the meters' floor, so its readout's −∞ and the Level fader's agree.
 */
import { PEAK_METER } from '@windsor/engine';
import { dbToAmplitude } from './meterModel';

/** Where the preference is kept in `localStorage`. */
export const CUE_LEVEL_STORAGE_KEY = 'windsor.console.cueLevel';

/** The knob's top, in dB over unity. */
export const CUE_LEVEL_MAX_DB = 6;

export const CUE_LEVEL = {
  label: 'Cue',
  title: 'Cue: the level of the chord audition and the metronome',
  /** Silent at the bottom stop. */
  min: 0,
  max: dbToAmplitude(CUE_LEVEL_MAX_DB),
  /** Unity, 0 dB. */
  def: 1,
  /** The log sweep starts at the meters' floor; the dial's bottom slice runs from silent to it. */
  logFloor: dbToAmplitude(PEAK_METER.floorDb),
} as const;
export type CueLevelTable = typeof CUE_LEVEL;

/**
 * The console's number formatters (#618): what a knob or a readout prints.
 * One set for every tab — a value formatted two ways in two panels is how the
 * returns' delay time came to read `1500m` beside a glide that read `1.50s`.
 */
import { CHORD_NOTE_NAMES, SEMITONES_PER_OCTAVE } from '@windsor/engine';

const MS_PER_SECOND = 1000;
const HZ_PER_KILOHERTZ = 1000;
const DEGREES_PER_CYCLE = 360;
/** MIDI octave numbering: note 60 is C4, so octave 0 begins at note 12. */
const MIDI_OCTAVE_OFFSET = -1;

export const fmt2 = (v: number): string => v.toFixed(2);
export const fmt0 = (v: number): string => v.toFixed(0);
/** Seconds: milliseconds under one second, seconds to two places from there. */
export const fmtMs = (v: number): string =>
  v < 1 ? `${(v * MS_PER_SECOND).toFixed(0)}m` : `${v.toFixed(2)}s`;
export const fmtHz = (v: number): string =>
  v >= HZ_PER_KILOHERTZ ? `${(v / HZ_PER_KILOHERTZ).toFixed(2)}k` : v.toFixed(0);
export const fmtSigned = (v: number): string => (v >= 0 ? '+' : '') + v.toFixed(2);
/** A phase kept in cycles (0..1), printed in whole degrees. */
export const fmtCycleDegrees = (v: number): string => `${(v * DEGREES_PER_CYCLE).toFixed(0)}°`;
/** A level or a biquad `Q` in dB, signed, one decimal. */
export const fmtDb = (v: number): string => `${(v >= 0 ? '+' : '') + v.toFixed(1)}dB`;

/** The pitch class of a MIDI note, 0..11, for any integer. */
export const pitchClass = (midi: number): number =>
  ((midi % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;

/** A MIDI note as the keyboard names it: `C4` for 60. */
export const noteName = (midi: number): string =>
  `${CHORD_NOTE_NAMES[pitchClass(midi)]}${Math.floor(midi / SEMITONES_PER_OCTAVE) + MIDI_OCTAVE_OFFSET}`;

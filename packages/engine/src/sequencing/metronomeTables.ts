/**
 * The metronome's clicks (windsor#906 decision 4), as data: the pitch and
 * velocity of the bar line's accent and of every other counted beat, how
 * long each click's note is held, and the part's voices.
 *
 * The level difference is velocity on one patch: `metronome-click.json`'s
 * one carrier has a velocity sensitivity of 1, so its amplitude is the
 * velocity itself (`voiceAmpRamp.ts`: `1 - velSens + velSens * velocity`),
 * and the beat's velocity is the accent's less `BEAT_BELOW_ACCENT_DB`.
 * Proposed values; tacowars listens.
 */

/** One click: its MIDI note and its velocity, 0..1. */
export interface MetronomeClick {
  readonly note: number;
  readonly velocity: number;
}

/** What the metronome reads. */
export interface MetronomeTable {
  /** The click on the bar line (`tickInBar === 0`). */
  readonly accent: MetronomeClick;
  /** The click on every other counted beat of the meter. */
  readonly beat: MetronomeClick;
  /**
   * Seconds from a click's note-on to its note-off: past the patch's
   * 35 ms decay to silence, so the note-off releases a voice already silent.
   */
  readonly gateSeconds: number;
  /** The aux part's voices: a click ends long before the next beat at any tempo. */
  readonly voices: number;
}

/** How far the beat's click sits under the accent's, in dB. */
const BEAT_BELOW_ACCENT_DB = 4;
/** dB to an amplitude ratio: `10 ** (dB / 20)`. */
const DB_PER_AMPLITUDE_DECADE = 20;

/** The engine part name the metronome plays on, on the aux path. */
export const METRONOME_PART_NAME = 'metronome';

/** The shipped clicks: A6 (1760 Hz) on the bar line, E6 (1318.5 Hz) on the other beats. */
export const METRONOME_TABLE: MetronomeTable = {
  accent: { note: 93, velocity: 1 },
  beat: { note: 88, velocity: 10 ** (-BEAT_BELOW_ACCENT_DB / DB_PER_AMPLITUDE_DECADE) },
  gateSeconds: 0.05,
  voices: 2,
};

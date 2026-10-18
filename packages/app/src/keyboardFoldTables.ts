/**
 * The keyboard fold's tunables (windsor#918, record `2026-10-18-keyboard-fold`):
 * the MIDI judge's grace window, the home row's letters, and the spelling and
 * range a folded key is named and judged by. `keyboardFold.ts` takes this
 * table as a parameter, defaulting to `KEYBOARD_FOLD_TABLE`.
 */
import { CHORD_NOTE_NAMES, MIDI_NOTE_MAX } from '@windsor/engine';

/**
 * The grace window (record decision 7, Decided 7): a MIDI note under a Chord
 * fold also passes when a chord starting within this many ticks after the
 * tick it was heard holds it. 1/16 at 24 PPQ, 125 ms at 120 BPM. The hand
 * tunes it, as the ear does a sound.
 */
export const GRACE_TICKS = 6;

/**
 * The home row (record decision 6): while folded, these letters play the
 * folded keys in order from the first, continuing past the shown keys.
 * Every other note letter plays nothing.
 */
export const HOME_ROW: readonly string[] = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"];

export interface KeyboardFoldTable {
  readonly graceTicks: number;
  readonly homeRow: readonly string[];
  /** A pitch class's name, the app's spelling (sharps only). */
  readonly names: readonly string[];
  /** The highest note that plays; a key past it is out of range. */
  readonly noteMax: number;
}

export const KEYBOARD_FOLD_TABLE: KeyboardFoldTable = {
  graceTicks: GRACE_TICKS,
  homeRow: HOME_ROW,
  names: CHORD_NOTE_NAMES,
  noteMax: MIDI_NOTE_MAX,
};

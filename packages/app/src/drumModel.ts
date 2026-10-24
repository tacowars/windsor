/**
 * The Drum device's pitch rules (windsor#951; record `2026-10-24-drum-device`
 * decision 1): the note a hit plays, how the Note box and the Pitch cell
 * read it, and what a press, a drag or a double-click on them writes. Pure:
 * `drumCard.ts` and `drumStepCells.ts` draw and send the write.
 *
 * A note is named as the Roll names one (`consoleFormat.ts`'s `noteName`,
 * middle C `C4`), and the Note box reads as the Euclid's (`C4 · 60`), the
 * other drum device's.
 */
import type { DrumHitStep, DrumStep } from '@windsor/engine';
import { DRUM_PITCH_MAX, MIDI_NOTE_MAX, SEMITONES_PER_OCTAVE } from '@windsor/engine';
import { noteName } from './consoleFormat';
import { DRUM_PITCH_DRAG, type DrumPitchDragTable } from './drumTables';
import { noteText } from './euclidStepperModel';

export { noteText };

/** A step type with its fields writable, for setting or dropping one key. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** A hit's pitch offset from the part's note: absent is 0. A rest has none. */
export const hitPitch = (step: DrumStep): number => (step.kind === 'hit' ? (step.pitch ?? 0) : 0);

/**
 * The note a hit at `pitch` plays over the part's `note`: their sum, moved
 * by whole octaves into MIDI 0–127 when it leaves it, as the engine plays
 * it (record `2026-10-24-drum-sequencer` decision 4).
 */
export function playedNote(note: number, pitch: number): number {
  let played = note + pitch;
  while (played > MIDI_NOTE_MAX) played -= SEMITONES_PER_OCTAVE;
  while (played < 0) played += SEMITONES_PER_OCTAVE;
  return played;
}

/** An offset with its sign: `+3`, `-2`, `0`. */
export const signedPitch = (pitch: number): string => (pitch > 0 ? `+${pitch}` : `${pitch}`);

/** What the Pitch cell reads (decision 1): the played note's name. */
export const pitchLabel = (note: number, pitch: number): string =>
  noteName(playedNote(note, pitch));

/** The Pitch cell's tooltip: the played note, the signed offset, and the gestures. */
export const pitchTitle = (note: number, pitch: number): string =>
  `${pitchLabel(note, pitch)} (${signedPitch(pitch)} from Note): drag up or down, double-click for ${noteName(note)}`;

/** A pitch offset held to whole semitones within ±`max`. */
export const clampPitch = (pitch: number, max = DRUM_PITCH_MAX): number =>
  Math.max(-max, Math.min(max, Math.round(pitch))) || 0;

/** The offset a vertical drag of `dy` px (up is negative) reaches from `from`. */
export const dragPitch = (
  from: number,
  dy: number,
  table: DrumPitchDragTable = DRUM_PITCH_DRAG,
): number => clampPitch(from - dy / table.semitonePx);

/**
 * The hit at offset `pitch`, held within ±`DRUM_PITCH_MAX`; at 0 it carries
 * no `pitch`, as the normaliser writes it. A rest comes back as it is.
 */
export function setHitPitch(step: DrumStep, pitch: number): DrumStep {
  if (step.kind !== 'hit') return step;
  const next: Mutable<DrumHitStep> = { ...step };
  const p = clampPitch(pitch);
  if (p === 0) delete next.pitch;
  else next.pitch = p;
  return next;
}

/** The Note box's press: one semitone down (-1) or up (+1) within MIDI, or null at the limit. */
export function noteStep(note: number, delta: -1 | 1): number | null {
  const next = Math.max(0, Math.min(MIDI_NOTE_MAX, note + delta));
  return next === note ? null : next;
}

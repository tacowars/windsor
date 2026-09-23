/**
 * From a chord's close stack to the MIDI notes a part plays (#606, record
 * `2026-09-17-606-chord-sequencer-degrees-per-part-voicing` §6): invert,
 * voice, transpose, then keep what the MIDI range can hold.
 *
 * Inversion rotates the close stack with octave carry — the written value is
 * taken modulo the stack's size and the quotient lifts the whole chord, so
 * inversion 3 of a triad is root position an octave up and the document keeps
 * the 3. The voicing (`CHORD_VOICINGS`, one per part) then transforms the
 * inverted stack. The result is ascending, without duplicates, and never more
 * than `CHORD_VOICING_NOTES_MAX` notes; a note outside 0–127 is dropped, never
 * clamped, since a clamped note would double a neighbour at the wrong pitch.
 */
import { CHORD_VOICING_NOTES_MAX, MIDI_NOTE_MAX } from '../audioConstants';
import { CHORD_VOICINGS, type ChordVoicing, type ChordVoicingId } from './chordTables';
import { SEMITONES_PER_OCTAVE } from '../sequencing/scaleSampler';

export interface VoiceOptions {
  readonly inversion: number;
  readonly voicing: ChordVoicingId;
  /** Octaves added to every note (the part's register plus the step's own). */
  readonly octave: number;
  /** Semitones added to every note. */
  readonly semitone: number;
}

/** The close stack rotated `inversion` times with octave carry, still ascending. */
export function invertStack(stack: readonly number[], inversion: number): number[] {
  const size = stack.length;
  if (size === 0) return [];
  const written = Math.max(0, Math.trunc(inversion));
  const rotations = written % size;
  const carry = Math.floor(written / size);
  const rotated = [
    ...stack.slice(rotations),
    ...stack.slice(0, rotations).map((n) => n + SEMITONES_PER_OCTAVE),
  ];
  return rotated.map((n) => n + carry * SEMITONES_PER_OCTAVE);
}

/** MIDI notes for a chord stack under the options, at a scale root of `rootNote`. */
export function voiceChord(
  stack: readonly number[],
  options: VoiceOptions,
  rootNote: number,
  voicings: Readonly<Record<string, ChordVoicing>> = CHORD_VOICINGS,
): number[] {
  const voicing = voicings[options.voicing] ?? CHORD_VOICINGS.close;
  const shift = rootNote + options.octave * SEMITONES_PER_OCTAVE + options.semitone;
  const notes = voicing
    .voice(invertStack(stack, options.inversion))
    .map((n) => n + shift)
    .filter((n) => n >= 0 && n <= MIDI_NOTE_MAX);
  return [...new Set(notes)].sort((a, b) => a - b).slice(0, CHORD_VOICING_NOTES_MAX);
}

/**
 * The diatonic chords of a scale (#606, record
 * `2026-09-17-606-chord-sequencer-degrees-per-part-voicing` §4): degree `d`'s
 * chord is the scale's degrees `d`, `d+2`, `d+4` (and `d+6` for a seventh)
 * stacked in thirds, each folded past the scale's end with octave carry
 * (`foldDegree`, #602). Over the seven-note scales this is textbook harmony;
 * over a pentatonic or a custom scale it still yields a chord per degree,
 * whose quality may be `other`.
 *
 * Everything here is in semitones from the *scale root*; nothing knows a MIDI
 * note, a key or a register — `chordVoicing.ts` adds those.
 */
import { CHORD_SIZE_SEVENTH, CHORD_SIZE_TRIAD } from '../audioConstants';
import { QUALITY_INTERVALS, type ChordQuality } from './chordTables';
import { SEMITONES_PER_OCTAVE, foldDegree } from '../sequencing/scaleSampler';

/** Triad or seventh: how many thirds are stacked. */
export type ChordSize = typeof CHORD_SIZE_TRIAD | typeof CHORD_SIZE_SEVENTH;
export const CHORD_SIZES: readonly ChordSize[] = [CHORD_SIZE_TRIAD, CHORD_SIZE_SEVENTH];

export function isChordSize(value: number): value is ChordSize {
  return (CHORD_SIZES as readonly number[]).includes(value);
}

export interface Chord {
  /** The written degree, as given. */
  readonly degree: number;
  readonly size: ChordSize;
  /** Semitones from the scale root, root of the chord first, close-stacked. */
  readonly stack: readonly number[];
  readonly quality: ChordQuality;
}

/** Degrees stacked in thirds: every other degree from `degree`, `size` of them. */
const THIRD = 2;

/** The close stack of degree `degree`'s chord, in semitones from the scale root. */
export function chordTones(offsets: readonly number[], degree: number, size: ChordSize): number[] {
  const count = Math.max(1, offsets.length);
  const stack: number[] = [];
  for (let tone = 0; tone < size; tone++) {
    const folded = foldDegree(degree + tone * THIRD, count);
    stack.push((offsets[folded.degree] ?? 0) + folded.carry * SEMITONES_PER_OCTAVE);
  }
  return stack;
}

/** The table quality whose intervals above the root match the stack's, else `other`. */
export function chordQuality(
  stack: readonly number[],
  table: Readonly<Record<string, readonly number[]>> = QUALITY_INTERVALS,
): ChordQuality {
  const root = stack[0] ?? 0;
  const intervals = stack.slice(1).map((n) => n - root);
  for (const [quality, wanted] of Object.entries(table)) {
    if (wanted.length === intervals.length && wanted.every((v, i) => v === intervals[i])) {
      return quality as ChordQuality;
    }
  }
  return 'other';
}

export function chordOf(offsets: readonly number[], degree: number, size: ChordSize): Chord {
  const stack = chordTones(offsets, degree, size);
  return { degree, size, stack, quality: chordQuality(stack) };
}

/** One chord per degree of the scale, in degree order — the picker's row. */
export function diatonicChords(offsets: readonly number[], size: ChordSize): Chord[] {
  return offsets.map((_, degree) => chordOf(offsets, degree, size));
}

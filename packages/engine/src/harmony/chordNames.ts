/**
 * What a chord is called (#606): its name from the root's note name and its
 * quality (`C min`, `G 7`, `A# maj7`), and its Roman-numeral analysis from
 * its degree and quality (`i`, `V7`, `viiø7`) — upper case for major and
 * augmented, lower for minor and diminished, the suffixes of
 * `QUALITY_LABELS`. An `other` chord is named by its notes and numbered by
 * its degree, since no numeral describes a stack the table does not know.
 * Spelling is sharps only (epic #605 decision 11). A chromatic event
 * (windsor#330) is named by its moved stack (`D# maj`) and its numeral takes
 * the accidental's glyph (`♭VI`).
 */
import {
  ACCIDENTAL_GLYPHS,
  CHORD_NOTE_NAMES,
  QUALITY_LABELS,
  ROMAN_GLYPHS,
  type ChordQuality,
} from './chordTables';
import type { Chord } from './chordTheory';
import { SEMITONES_PER_OCTAVE, foldDegree } from '../sequencing/scaleSampler';

/** A one-based degree as a Roman numeral; degrees are small, so tens suffice. */
export function toRoman(n: number): string {
  let left = Math.max(1, Math.trunc(n));
  let out = '';
  for (const [value, glyph] of ROMAN_GLYPHS) {
    while (left >= value) {
      out += glyph;
      left -= value;
    }
  }
  return out;
}

/** The pitch-class name of a semitone offset from the scale root at `rootNote`. */
export function pitchClassName(rootNote: number, semitones: number): string {
  const pc =
    (((rootNote + semitones) % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;
  return CHORD_NOTE_NAMES[pc] ?? String(pc);
}

/** `C min`, `D# maj`, `G 7`; an `other` chord lists its notes: `C·E·A`. */
export function chordName(rootNote: number, chord: Chord): string {
  const root = chord.stack[0] ?? 0;
  if (chord.quality === 'other') {
    return chord.stack.map((n) => pitchClassName(rootNote, n)).join('·');
  }
  return `${pitchClassName(rootNote, root)} ${QUALITY_LABELS[chord.quality].name}`;
}

/**
 * The numeral for `degree` in a scale of `degreeCount` degrees: the degree is
 * folded first, so the eighth degree of a seven-note scale reads as the
 * first. An `other` quality reads as the plain one-based number. A flat or
 * sharp `accidental` prefixes its glyph: `♭VI`, `♯iv°`.
 */
export function romanNumeral(
  degree: number,
  quality: ChordQuality,
  degreeCount: number,
  accidental = 0,
): string {
  const folded = foldDegree(degree, degreeCount).degree + 1;
  const glyph = accidental === -1 || accidental === 1 ? ACCIDENTAL_GLYPHS[accidental] : '';
  if (quality === 'other') return `${glyph}${folded}`;
  const label = QUALITY_LABELS[quality];
  const numeral = toRoman(folded);
  return `${glyph}${label.upper ? numeral : numeral.toLowerCase()}${label.suffix}`;
}

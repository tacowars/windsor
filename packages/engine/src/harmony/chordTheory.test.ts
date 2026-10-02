import { describe, expect, it } from 'vitest';

import { SCALES } from '../audioConstants';
import { HARMONY_DEGREE_MAX } from '../audioConstants';
import {
  chordOf,
  chordQuality,
  chordTones,
  diatonicChords,
  eventChord,
  eventStack,
} from './chordTheory';

const qualities = (scale: readonly number[], size: 3 | 4): string[] =>
  diatonicChords(scale, size).map((c) => c.quality);

describe('chordTheory', () => {
  it('stacks thirds over the major scale into the textbook triads and sevenths', () => {
    expect(qualities(SCALES.major, 3)).toEqual(['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim']);
    expect(qualities(SCALES.major, 4)).toEqual([
      'maj7',
      'min7',
      'min7',
      'maj7',
      'dom7',
      'min7',
      'halfDim7',
    ]);
  });

  it('knows the natural minor, dorian, mixolydian and lydian sets', () => {
    expect(qualities(SCALES.naturalMinor, 3)).toEqual([
      'min',
      'dim',
      'maj',
      'min',
      'min',
      'maj',
      'maj',
    ]);
    expect(qualities(SCALES.dorian, 3)).toEqual(['min', 'min', 'maj', 'maj', 'min', 'dim', 'maj']);
    expect(qualities(SCALES.mixolydian, 3)).toEqual([
      'maj',
      'min',
      'dim',
      'maj',
      'min',
      'min',
      'maj',
    ]);
    expect(qualities(SCALES.lydian, 3)).toEqual(['maj', 'maj', 'min', 'dim', 'maj', 'min', 'min']);
  });

  it('gives the stack in semitones from the scale root, chord root first', () => {
    expect(chordTones(SCALES.major, 0, 3)).toEqual([0, 4, 7]);
    expect(chordTones(SCALES.major, 4, 4)).toEqual([7, 11, 14, 17]);
    expect(chordTones(SCALES.naturalMinor, 6, 3)).toEqual([10, 14, 17]);
  });

  it('a pentatonic stack the table does not know is `other`', () => {
    const chord = chordOf(SCALES.pentatonicMajor, 0, 3);
    expect(chord.stack).toEqual([0, 4, 9]);
    expect(chord.quality).toBe('other');
    expect(diatonicChords(SCALES.pentatonicMajor, 3)).toHaveLength(5);
  });

  it('a degree past the scale is the folded degree an octave up', () => {
    const first = chordTones(SCALES.major, 0, 3);
    expect(chordTones(SCALES.major, 7, 3)).toEqual(first.map((n) => n + 12));
    expect(chordOf(SCALES.major, 7, 3).quality).toBe('maj');
    expect(chordTones(SCALES.pentatonicMinor, 6, 3)).toEqual(
      chordTones(SCALES.pentatonicMinor, 1, 3).map((n) => n + 12),
    );
  });

  it('a one-degree scale stacks octaves of the root and never throws', () => {
    for (let degree = 0; degree < 10; degree++) {
      const chord = chordOf([0], degree, 4);
      expect(chord.stack.every((n) => n % 12 === 0)).toBe(true);
      expect(chord.quality).toBe('other');
    }
    expect(chordTones([], 0, 3)).toEqual([0, 24, 48]);
  });

  it('classifies every named quality from its intervals', () => {
    expect(chordQuality([0, 4, 8])).toBe('aug');
    expect(chordQuality([0, 3, 7, 11])).toBe('mMaj7');
    expect(chordQuality([0, 3, 6, 9])).toBe('dim7');
    expect(chordQuality([0, 4, 8, 11])).toBe('augMaj7');
    expect(chordQuality([0, 4, 8, 10])).toBe('aug7');
    expect(chordQuality([5, 9, 12])).toBe('maj');
    expect(chordQuality([0, 5, 7])).toBe('other');
    expect(chordQuality([])).toBe('other');
  });
});

describe('eventStack (windsor#330)', () => {
  it('is chordTones exactly when the event names neither field', () => {
    for (const scale of [SCALES.major, SCALES.naturalMinor, SCALES.pentatonicMinor, [0]]) {
      for (let degree = 0; degree < 16; degree++) {
        for (const size of [3, 4] as const) {
          expect(eventStack(scale, { degree, size })).toEqual(chordTones(scale, degree, size));
          expect(eventChord(scale, { degree, size })).toEqual(chordOf(scale, degree, size));
        }
      }
    }
  });

  it('moves the whole diatonic chord by the accidental, keeping its quality', () => {
    // ♭vi in C major: A minor down a semitone is G♯ minor.
    expect(eventStack(SCALES.major, { degree: 5, size: 3, accidental: -1 })).toEqual([8, 11, 15]);
    expect(eventChord(SCALES.major, { degree: 5, size: 3, accidental: -1 }).quality).toBe('min');
    expect(eventStack(SCALES.major, { degree: 1, size: 4, accidental: 1 })).toEqual([3, 6, 10, 13]);
  });

  it('builds a named quality on the degree’s root, then moves it', () => {
    // ♭I major in C: B D♯ F♯, a semitone under the key root.
    const flatOne = { degree: 0, size: 3, quality: 'maj', accidental: -1 } as const;
    expect(eventStack(SCALES.major, flatOne)).toEqual([-1, 3, 6]);
    expect(eventChord(SCALES.major, flatOne)).toEqual({
      degree: 0,
      size: 3,
      stack: [-1, 3, 6],
      quality: 'maj',
    });
    // ♭VI major in C: A♭ C E♭.
    expect(
      eventStack(SCALES.major, { degree: 5, size: 3, quality: 'maj', accidental: -1 }),
    ).toEqual([8, 12, 15]);
    // V7 in A natural minor: E G♯ B D, a seventh because the quality has three intervals.
    const dominant = eventChord(SCALES.naturalMinor, { degree: 4, size: 4, quality: 'dom7' });
    expect(dominant.stack).toEqual([7, 11, 14, 17]);
    expect(dominant.quality).toBe('dom7');
  });

  it('folds the top degree with octave carry before it shifts', () => {
    const top = { degree: HARMONY_DEGREE_MAX, size: 3 } as const;
    const folded = chordTones(SCALES.major, HARMONY_DEGREE_MAX, 3);
    expect(folded).toEqual([83, 86, 89]);
    expect(eventStack(SCALES.major, { ...top, accidental: 1 })).toEqual([84, 87, 90]);
    expect(eventStack(SCALES.major, { ...top, quality: 'min', accidental: -1 })).toEqual([
      82, 85, 89,
    ]);
  });

  it('builds a quality from the single root of a one-degree scale', () => {
    expect(eventStack([0], { degree: 0, size: 4, quality: 'maj7' })).toEqual([0, 4, 7, 11]);
    expect(eventStack([0], { degree: 2, size: 3, quality: 'dim' })).toEqual([24, 27, 30]);
    expect(eventStack([], { degree: 0, size: 3, quality: 'aug', accidental: 1 })).toEqual([
      1, 5, 9,
    ]);
  });
});

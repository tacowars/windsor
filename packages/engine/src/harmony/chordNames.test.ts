import { describe, expect, it } from 'vitest';

import { SCALES } from '../audioConstants';
import { chordName, pitchClassName, romanNumeral, toRoman } from './chordNames';
import { chordOf, diatonicChords, eventChord, type ChordSpelling } from './chordTheory';

const labels = (root: number, scale: readonly number[], size: 3 | 4): string[] =>
  diatonicChords(scale, size).map(
    (c) => `${chordName(root, c)} ${romanNumeral(c.degree, c.quality, scale.length)}`,
  );

describe('chordNames', () => {
  it('reads C natural minor as Scaler does, spelled with sharps', () => {
    expect(labels(48, SCALES.naturalMinor, 3)).toEqual([
      'C min i',
      'D dim ii°',
      'D# maj III',
      'F min iv',
      'G min v',
      'G# maj VI',
      'A# maj VII',
    ]);
  });

  it('reads the C major sevenths', () => {
    expect(
      diatonicChords(SCALES.major, 4).map((c) => romanNumeral(c.degree, c.quality, 7)),
    ).toEqual(['Imaj7', 'ii7', 'iii7', 'IVmaj7', 'V7', 'vi7', 'viiø7']);
    expect(chordName(60, chordOf(SCALES.major, 4, 4))).toBe('G 7');
    expect(chordName(60, chordOf(SCALES.major, 6, 4))).toBe('B m7b5');
  });

  it('names an `other` chord by its notes and numbers it by degree', () => {
    const chord = chordOf(SCALES.pentatonicMajor, 0, 3);
    expect(chordName(60, chord)).toBe('C·E·A');
    expect(romanNumeral(0, chord.quality, 5)).toBe('1');
    expect(romanNumeral(6, chord.quality, 5)).toBe('2');
  });

  it('folds the degree before numbering it', () => {
    expect(romanNumeral(7, 'maj', 7)).toBe('I');
    expect(romanNumeral(8, 'min', 7)).toBe('ii');
    expect(romanNumeral(4, 'dom7', 7)).toBe('V7');
    expect(romanNumeral(3, 'aug', 7)).toBe('IV+');
  });

  it('spells pitch classes from any root and offset', () => {
    expect(pitchClassName(60, 0)).toBe('C');
    expect(pitchClassName(61, 14)).toBe('D#');
    expect(pitchClassName(0, -1)).toBe('B');
  });

  it('writes small Roman numerals', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 24].map(toRoman)).toEqual([
      'I',
      'II',
      'III',
      'IV',
      'V',
      'VI',
      'VII',
      'VIII',
      'IX',
      'X',
      'XII',
      'XXIV',
    ]);
  });
});

describe('chromatic events (windsor#330)', () => {
  const label = (scale: readonly number[], event: ChordSpelling): string => {
    const chord = eventChord(scale, event);
    return `${chordName(60, chord)} ${romanNumeral(event.degree, chord.quality, scale.length, event.accidental)}`;
  };

  it('names the moved stack and prefixes the numeral with the accidental', () => {
    expect(label(SCALES.major, { degree: 0, size: 3, quality: 'maj', accidental: -1 })).toBe(
      'B maj ♭I',
    );
    expect(label(SCALES.major, { degree: 5, size: 3, quality: 'maj', accidental: -1 })).toBe(
      'G# maj ♭VI',
    );
    expect(label(SCALES.major, { degree: 5, size: 3, accidental: -1 })).toBe('G# min ♭vi');
    expect(label(SCALES.naturalMinor, { degree: 4, size: 4, quality: 'dom7' })).toBe('G 7 V7');
  });

  it('reads sharps, the `other` numbers and a natural as today', () => {
    expect(romanNumeral(3, 'dim', 7, 1)).toBe('♯iv°');
    expect(romanNumeral(5, 'other', 5, -1)).toBe('♭1');
    expect(romanNumeral(4, 'dom7', 7, 0)).toBe('V7');
    expect(romanNumeral(4, 'dom7', 7)).toBe('V7');
  });
});

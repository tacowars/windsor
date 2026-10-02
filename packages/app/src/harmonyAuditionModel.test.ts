/**
 * Which chord a harmony card ▶ sounds (windsor#332 decision 5): the selected
 * degree's ▶ plays the block as written, every other ▶ the scale's own chord
 * at the block's size; voiced close from the key root in octave 4 with the
 * root doubled an octave below.
 */
import { describe, expect, it } from 'vitest';

import type { Harmony, HarmonyEvent } from '@windsor/engine';
import { CHORD_SIZE_SEVENTH, CHORD_SIZE_TRIAD, TICKS_PER_BAR } from '@windsor/engine';
import { auditionChord, auditionEvent } from './harmonyAuditionModel';

const C_MAJOR: Harmony = { root: 0, scale: 'major', events: [] };
const FLAT_SIX: HarmonyEvent = {
  start: 0,
  duration: TICKS_PER_BAR,
  degree: 5,
  size: CHORD_SIZE_TRIAD,
  quality: 'maj',
  accidental: -1,
};

describe('the chord a ▶ plays', () => {
  it('plays the selected block as written on its own degree', () => {
    expect(auditionChord(C_MAJOR, FLAT_SIX, 5)).toEqual({
      notes: [56, 68, 72, 75],
      label: { name: 'G# maj', numeral: '♭VI', sizeTag: 'triad' },
    });
  });

  it("plays the scale's own chord on any other degree, at the block's size", () => {
    expect(auditionChord(C_MAJOR, FLAT_SIX, 0)).toEqual({
      notes: [48, 60, 64, 67],
      label: { name: 'C maj', numeral: 'I', sizeTag: 'triad' },
    });
    expect(auditionEvent(FLAT_SIX, 0)).not.toHaveProperty('quality');
    expect(auditionEvent(FLAT_SIX, 0)).not.toHaveProperty('accidental');
  });

  it('makes every other degree a seventh under a seventh block', () => {
    const seventh = { ...FLAT_SIX, size: CHORD_SIZE_SEVENTH, quality: 'dom7' } as const;
    for (const degree of [0, 1, 2, 3, 4, 6]) {
      const chord = auditionChord(C_MAJOR, seventh, degree);
      expect(chord.label.sizeTag).toBe('7th');
      expect(chord.notes).toHaveLength(5);
    }
    expect(auditionChord(C_MAJOR, seventh, 4)).toEqual({
      notes: [55, 67, 71, 74, 77],
      label: { name: 'G 7', numeral: 'V7', sizeTag: '7th' },
    });
  });

  it("carries a stack past the octave the way eventStack does, from the key's own root", () => {
    // B diminished in C major stacks B D F: D and F carry into the next octave.
    expect(auditionChord(C_MAJOR, FLAT_SIX, 6).notes).toEqual([59, 71, 74, 77]);
    // A minor key on A: the tonic sits at A4 (69), its root doubled at A3.
    const aMinor: Harmony = { root: 9, scale: 'naturalMinor', events: [] };
    expect(auditionChord(aMinor, FLAT_SIX, 0).notes).toEqual([57, 69, 72, 76]);
  });

  it('drops a note outside MIDI rather than clamping it', () => {
    const chord = auditionChord(C_MAJOR, FLAT_SIX, 5, { keyOctaveNote: 110, bassOctaves: 1 });
    expect(chord.notes).toEqual([106, 118, 122, 125]);
    const high = auditionChord(C_MAJOR, FLAT_SIX, 6, { keyOctaveNote: 116, bassOctaves: 1 });
    expect(high.notes.every((n) => n <= 127)).toBe(true);
    expect(high.notes).toEqual([115, 127]);
    const low = auditionChord(C_MAJOR, FLAT_SIX, 0, { keyOctaveNote: 4, bassOctaves: 1 });
    expect(low.notes).toEqual([4, 8, 11]);
  });
});

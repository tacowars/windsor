/**
 * Which chord a harmony card ▶ sounds (windsor#332 decision 5): the selected
 * degree's ▶ plays the block as written, every other ▶ the scale's own chord
 * at the block's size; voiced close from the key root in octave 4 with the
 * root doubled an octave below.
 */
import { describe, expect, it } from 'vitest';

import type { Harmony, HarmonyEvent } from '@windsor/engine';
import {
  CHORD_SIZE_SEVENTH,
  CHORD_SIZE_TRIAD,
  HARMONY_DEGREE_MAX,
  TICKS_PER_BAR,
} from '@windsor/engine';
import { AuditionHold, auditionChord, auditionEvent } from './harmonyAuditionModel';

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
    expect(auditionEvent(FLAT_SIX, 0, 7)).not.toHaveProperty('quality');
    expect(auditionEvent(FLAT_SIX, 0, 7)).not.toHaveProperty('accidental');
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

  it("plays a degree past the scale on its folded degree's ▶, octave carry included", () => {
    // Degree 7 in C major is the tonic one octave up (foldDegree): the I ▶ plays it there.
    const plain: HarmonyEvent = {
      start: 0,
      duration: TICKS_PER_BAR,
      degree: 7,
      size: CHORD_SIZE_TRIAD,
    };
    expect(auditionEvent(plain, 0, 7)).toBe(plain);
    expect(auditionChord(C_MAJOR, plain, 0).notes).toEqual([60, 72, 76, 79]);
    expect(auditionChord(C_MAJOR, { ...plain, degree: 0 }, 0).notes).toEqual([48, 60, 64, 67]);
  });

  it('keeps the quality and accidental of the highest degree on its folded ▶', () => {
    const top: HarmonyEvent = { ...FLAT_SIX, degree: HARMONY_DEGREE_MAX };
    const folded = HARMONY_DEGREE_MAX % 7;
    const carry = Math.floor(HARMONY_DEGREE_MAX / 7);
    expect(auditionEvent(top, folded, 7)).toBe(top);
    // From C at MIDI 0 so the carried chord stays inside MIDI: ♭VII major, Bb D F.
    const low = { keyOctaveNote: 0, bassOctaves: 1 };
    const flatSeven = carry * 12 + 10;
    expect(auditionChord(C_MAJOR, top, folded, low)).toEqual({
      notes: [flatSeven - 12, flatSeven, flatSeven + 4, flatSeven + 7],
      label: { name: 'A# maj', numeral: '♭VII', sizeTag: 'triad' },
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

describe('which press owns the held chord', () => {
  it("never lets a superseded pointer's up release the later press", () => {
    const hold = new AuditionHold();
    const a = hold.press({ kind: 'pointer', pointerId: 1 });
    const b = hold.press({ kind: 'pointer', pointerId: 2 });
    expect(hold.releases(a, 1)).toBe(false);
    expect(hold.owns(b)).toBe(true);
    expect(hold.releases(b, 2)).toBe(true);
  });

  it('releases nothing on an unrelated pointer up', () => {
    const hold = new AuditionHold();
    const a = hold.press({ kind: 'pointer', pointerId: 1 });
    expect(hold.releases(a, 7)).toBe(false);
    expect(hold.releases(a, null)).toBe(false);
  });

  it('ends a key press only on its own keyup or blur', () => {
    const hold = new AuditionHold();
    const pointer = hold.press({ kind: 'pointer', pointerId: 3 });
    const key = hold.press({ kind: 'key' });
    expect(hold.releases(pointer, 3)).toBe(false);
    expect(hold.releases(key, 3)).toBe(false);
    expect(hold.releases(key, null)).toBe(true);
    hold.clear();
    expect(hold.releases(key, null)).toBe(false);
  });
});

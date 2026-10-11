/**
 * Song chord's sets (windsor#729): a chord's set is its stack's pitch
 * classes above the song's root, for a triad, a seventh, a named quality, a
 * ♭ and a ♯, a degree past the scale and a custom scale; and the timeline's
 * lookup is `chordAt`'s at every tick, the leading hold of a first chord
 * after tick 0 included, with no chords falling back to the song key.
 */
import { describe, expect, it } from 'vitest';

import type { Harmony, HarmonyEvent } from '../harmony/harmonyTimeline';
import { chordAt } from '../harmony/harmonyTimeline';
import { SCALES } from '../sequencing/scaleSampler';
import { chordMaskAt, chordTimeline } from './bloomChordTimeline';
import { chordPitches, pitchMask } from './bloomPitches';

/** The set of the pitch classes named. */
const classes = (...pcs: number[]): number => pcs.reduce((mask, pc) => mask | (1 << pc), 0);
const chord = (event: Omit<HarmonyEvent, 'start' | 'duration'>): HarmonyEvent => ({
  start: 0,
  duration: 96,
  ...event,
});
const C_MAJOR = { root: 0, scale: 'major' } as const;

describe("a chord's set", () => {
  it('is its stack above the root: triad, seventh, quality, ♭, ♯, octave carry, custom scale', () => {
    // C E G; G B D F.
    expect(chordPitches(C_MAJOR, chord({ degree: 0, size: 3 }))).toBe(classes(0, 4, 7));
    expect(chordPitches(C_MAJOR, chord({ degree: 4, size: 4 }))).toBe(classes(7, 11, 2, 5));
    // ii as a dominant seventh: D F♯ A C.
    const dom = chord({ degree: 1, size: 4, quality: 'dom7' });
    expect(chordPitches(C_MAJOR, dom)).toBe(classes(2, 6, 9, 0));
    // An accidental moves every tone: ♭VII major is B♭ D F; ♯IV is F A C up a semitone, F♯ A♯ C♯.
    const flat = chord({ degree: 6, size: 3, quality: 'maj', accidental: -1 });
    expect(chordPitches(C_MAJOR, flat)).toBe(classes(10, 2, 5));
    expect(chordPitches(C_MAJOR, chord({ degree: 3, size: 3, accidental: 1 }))).toBe(
      classes(6, 10, 1),
    );
    // Degree 9 is degree 2 an octave up: E G B, the carry folded away.
    expect(chordPitches(C_MAJOR, chord({ degree: 9, size: 3 }))).toBe(classes(4, 7, 11));
    // A custom scale above D, offsets 0 2 5 7 10: degree 1's triad stacks 2 7 12 → E A D.
    const custom = { root: 2, scale: [0, 2, 5, 7, 10] };
    expect(chordPitches(custom, chord({ degree: 1, size: 3 }))).toBe(classes(4, 9, 2));
  });
});

describe('the timeline', () => {
  const SONG = 4 * 96;
  /** I from bar 2, vi from bar 3, IV in bar 4: before bar 2 the IV holds (cyclic). */
  const LATE: Harmony = {
    root: 7,
    scale: 'major',
    events: [
      { start: 96, duration: 96, degree: 0, size: 3 },
      { start: 192, duration: 96, degree: 5, size: 3 },
      { start: 288, duration: 96, degree: 3, size: 4, accidental: -1 },
    ],
  };

  it("is chordAt's chord at every tick, the last chord's leading hold included", () => {
    const timeline = chordTimeline(LATE, SONG);
    for (let tick = 0; tick < SONG; tick++) {
      const want = pitchMask(LATE.root, chordAt(LATE, SONG, tick)!.stack);
      expect(chordMaskAt(timeline, tick), `${tick}`).toBe(want);
    }
    expect(chordMaskAt(timeline, 0)).toBe(chordMaskAt(timeline, 288));
    expect(Array.from(timeline.starts)).toEqual([0, 96, 192, 288]);
  });

  it("is the song key's set throughout with no chords", () => {
    const timeline = chordTimeline({ root: 2, scale: 'dorian', events: [] }, SONG);
    expect(chordMaskAt(timeline, 0)).toBe(pitchMask(2, SCALES.dorian));
    expect(chordMaskAt(timeline, SONG - 1)).toBe(pitchMask(2, SCALES.dorian));
  });
});

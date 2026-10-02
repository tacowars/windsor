import { describe, expect, it } from 'vitest';

import { followVoices } from './voiceLeading';

/** C4 as the key root: a stack's tones are semitones above it. */
const C = 60;
const MAJOR = [0, 4, 7];
const MINOR = [0, 3, 7];

describe('followVoices (windsor#333)', () => {
  it('I → V in C: G is held, C steps down to B and E down to D', () => {
    // V is G B D: 7 above C, close-stacked.
    expect(followVoices([60, 64, 67], [7, 11, 14], C)).toEqual([59, 62, 67]);
  });

  it('C → A minor holds C and E and moves G up to A', () => {
    expect(followVoices([60, 64, 67], [9, 12, 16], C)).toEqual([60, 64, 69]);
  });

  it('C → F holds C, moves E up a semitone to F, and G to A because F is taken', () => {
    expect(followVoices([60, 64, 67], [5, 9, 12], C)).toEqual([60, 65, 69]);
  });

  it('a voice equidistant from two free targets moves down', () => {
    // D sits a tone from C and from E: C wins. F then takes E, A takes G.
    expect(followVoices([62, 65, 69], MAJOR, C)).toEqual([60, 64, 67]);
  });

  it('only the pitch class of the key root counts', () => {
    expect(followVoices([60, 64, 67], [7, 11, 14], C + 24)).toEqual([59, 62, 67]);
    // A minor's i (A C E) in A, from C major: C and E held, G steps up to A.
    expect(followVoices([60, 64, 67], MINOR, 57)).toEqual([60, 64, 69]);
  });

  it('a seventh under three voices leaves a tone unsounded', () => {
    // vii7 in C (B D F A): every voice moves, and D goes unsounded.
    expect(followVoices([60, 64, 67], [11, 14, 17, 21], C)).toEqual([59, 65, 69]);
  });

  it('a triad under four voices lets two share a pitch class an octave apart', () => {
    // Cmaj7 → G: G and B are held, C steps down to B3, E down to D.
    const moved = followVoices([60, 64, 67, 71], [7, 11, 14], C);
    expect(moved).toEqual([59, 62, 67, 71]);
    expect(moved.length).toBe(4);
  });

  it('keeps a voice whose every target within six semitones is taken', () => {
    // A unison chord on C: the C is held, C♯ has no free C within ±6 and stays.
    expect(followVoices([60, 61], [0], C)).toEqual([60, 61]);
  });

  it('moves the lowest voice first, and answers in the held order', () => {
    // Held high to low: C♯ moves first and takes C, so D, a tone from both, goes up to E.
    // Were D first, the tie would have sent it down to C and C♯ up to E.
    expect(followVoices([62, 61], [0, 4], C)).toEqual([64, 60]);
  });

  it('never moves a voice below MIDI note 0', () => {
    // C major at register −1, I → V: C would step down to −1 (B). It takes D at 2
    // instead, and E, with D taken and no other in-range target within six, stays.
    const moved = followVoices([0, 4, 7], [7, 11, 14], 0);
    expect(moved).toEqual([2, 4, 7]);
    expect(Math.min(...moved)).toBeGreaterThanOrEqual(0);
  });

  it('never moves a voice above MIDI note 127', () => {
    // C major at register 9, I → IV: E takes F at 125, and G, whose only free
    // target within six is A at 129, keeps its note.
    const moved = followVoices([120, 124, 127], [5, 9, 12], 0);
    expect(moved).toEqual([120, 125, 127]);
    expect(Math.max(...moved)).toBeLessThanOrEqual(127);
  });

  it('a chord with the same tones moves nothing', () => {
    expect(followVoices([48, 64, 67, 72], MAJOR, C)).toEqual([48, 64, 67, 72]);
    expect(followVoices([], MAJOR, C)).toEqual([]);
  });
});

/**
 * Where a held note and a held pointer land when the keys change (record
 * `2026-10-17-keyboard-geometry-follows-the-layout` decision 2, amended by
 * `2026-10-18-keyboard-fold` decision 5), on the fold record's boundary
 * cases: A minor's chords at octave 3, A min A3 C4 E4 A4 C5 E5 A5 (45 …
 * 69), F maj F3 A3 C4 F4 A4 C5 F5 (41 … 65), C maj and G 7.
 */
import { describe, expect, it } from 'vitest';

import { followFinger, keysCarrying } from './keyboardHeld';

const A_MIN = [45, 48, 52, 57, 60, 64, 69];
const F_MAJ = [41, 45, 48, 53, 57, 60, 65];
const G_7 = [43, 47, 50, 53, 55, 59, 62, 65, 67];
const A4 = 57;

describe('the keys carrying a held note', () => {
  it('are every shown key with its note, two where two rows share their closing note', () => {
    expect(keysCarrying(A4, A_MIN)).toEqual([3]);
    expect(keysCarrying(A4, F_MAJ)).toEqual([4]);
    expect(keysCarrying(57, [45, 48, 52, 57, 57, 60, 64, 69])).toEqual([3, 4]);
    expect(keysCarrying(A4, G_7)).toEqual([]);
  });
});

describe('a held pointer when the keys change', () => {
  it('keeps its key through a rename: a finger on A min’s A4 stays on the fourth key at F maj', () => {
    const carriers = keysCarrying(A4, F_MAJ);
    expect(followFinger({ offset: 3, carriers, count: F_MAJ.length, renamed: true })).toEqual({
      offset: 3,
    });
  });

  it('keeps its note from a triad to a seventh, and from a seventh down to a triad past its key', () => {
    // C maj (7 keys) to G 7 (9 keys): the finger on C maj's E4 keeps it, no G 7 key carrying it.
    const e4 = keysCarrying(52, G_7);
    expect(followFinger({ offset: 2, carriers: e4, count: G_7.length, renamed: true })).toEqual({
      offset: 2,
    });
    // G 7's last key under a finger, back to a 7-key triad: no lift at the rename.
    const g5 = keysCarrying(67, A_MIN);
    expect(followFinger({ offset: 8, carriers: g5, count: A_MIN.length, renamed: true })).toEqual({
      offset: 8,
    });
  });

  it('keeps its key and note through a Fold switch, Off to Scale and back', () => {
    // Off's 24 keys from C4 to Scale's 15 from A3: the finger on G♯5 (offset 20) holds on.
    expect(followFinger({ offset: 20, carriers: [], count: 15, renamed: true })).toEqual({
      offset: 20,
    });
  });

  it('follows its note at a re-render or octave shift, and lifts when no shown key carries it', () => {
    const carriers = keysCarrying(A4, F_MAJ);
    expect(followFinger({ offset: 3, carriers, count: 7, renamed: false })).toEqual({ offset: 4 });
    // On one of two keys carrying its note, it stays on its own.
    expect(followFinger({ offset: 4, carriers: [3, 4], count: 8, renamed: false })).toEqual({
      offset: 4,
    });
    expect(followFinger({ offset: 3, carriers: [], count: 9, renamed: false })).toBe('lift');
  });

  it('holding no note, stays unless its key is past the row', () => {
    expect(followFinger({ offset: 5, carriers: null, count: 7, renamed: true })).toEqual({
      offset: 5,
    });
    expect(followFinger({ offset: 8, carriers: null, count: 7, renamed: false })).toBe('lift');
    expect(followFinger({ offset: null, carriers: null, count: 7, renamed: false })).toEqual({
      offset: null,
    });
  });
});

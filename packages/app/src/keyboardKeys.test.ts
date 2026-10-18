/**
 * The keyboard names its notes as the Roll does, note 60 C4 (windsor#931,
 * record `2026-10-18-keyboard-names-notes-as-the-roll`): the octave label and
 * the expanded view's C names come from `octaveLabel`, a folded root from
 * `foldKeyName`, both through the Roll's `noteName`.
 */
import { describe, expect, it } from 'vitest';

import { noteName } from './consoleFormat';
import { OCTAVE_DEFAULT, OCTAVE_MIN } from './keyboardConstants';
import { foldKeyName, octaveLabel } from './keyboardKeys';
import { octaveMaxFor } from './keyboardViewModel';

describe('the keyboard’s note names', () => {
  it('labels the default octave C3, its first key note 48', () => {
    expect(OCTAVE_DEFAULT * 12).toBe(48);
    expect(octaveLabel(OCTAVE_DEFAULT)).toBe('C3');
  });

  it('names the expanded view’s Cs at 4 octaves C3, C4, C5 and C6 at the default octave', () => {
    expect([0, 1, 2, 3].map((up) => octaveLabel(OCTAVE_DEFAULT + up))).toEqual([
      'C3',
      'C4',
      'C5',
      'C6',
    ]);
  });

  it('reads C-1 at the lowest bound and C7 at the highest for 1 or 2 octaves', () => {
    expect(octaveLabel(OCTAVE_MIN)).toBe('C-1');
    expect(octaveMaxFor(1)).toBe(8);
    expect(octaveMaxFor(2)).toBe(8);
    expect(octaveLabel(8)).toBe('C7');
  });

  it('names note 57 A3, as the Roll does', () => {
    const key = { note: 57, name: 'A', root: true, outOfRange: false };
    expect(foldKeyName(key)).toBe('A3');
    expect(noteName(57)).toBe('A3');
  });
});

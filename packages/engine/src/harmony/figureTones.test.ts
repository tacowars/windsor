/** The Figure's chord-tone rule (windsor#484): a tone into the stack with octave carry. */
import { describe, expect, it } from 'vitest';

import { figureNote } from './figureTones';

const C4 = 60;
const TRIAD = [0, 4, 7];
const SEVENTH = [0, 4, 7, 11];

describe('figureNote (windsor#484)', () => {
  it('wraps a tone past the stack with octave carry, both ways', () => {
    expect(figureNote(TRIAD, 3, C4)).toBe(C4 + 12);
    expect(figureNote(TRIAD, -1, C4)).toBe(C4 + 7 - 12);
    expect(figureNote(SEVENTH, 4, C4)).toBe(C4 + 12);
  });

  it('is null on an empty stack', () => {
    expect(figureNote([], 0, C4)).toBeNull();
  });
});

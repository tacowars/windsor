/**
 * The keyboard's geometry (windsor#863): the key under a point over boxes as a
 * page lays them out, the strike velocity down a key, and the octaves a keys
 * box shows. The boxes are written out by hand for one octave of the touch
 * row (white keys 40 px wide, 100 px high, black keys 60 % × 62 % centred on
 * the line between their two whites), and a second row below it, 12 px down,
 * as the expanded view's two rows will lay them out.
 */
import { describe, expect, it } from 'vitest';

import { TOUCH_VELOCITY_FLOOR, TOUCH_VELOCITY_FULL } from './keyboardConstants';
import {
  afterWhite,
  isBlackKey,
  keyAt,
  keyCountFor,
  octavesFor,
  strikeVelocity,
  whiteCount,
} from './keyboardLayout';
import type { KeyBox } from './keyboardLayout';

const white = (offset: number, index: number, top = 0): KeyBox => ({
  offset,
  black: false,
  left: index * 40,
  right: index * 40 + 40,
  top,
  bottom: top + 100,
});
const black = (offset: number, after: number, top = 0): KeyBox => ({
  offset,
  black: true,
  left: after * 40 + 28,
  right: after * 40 + 52,
  top,
  bottom: top + 62,
});

/** C to E of a row at `top`, with offsets from `first`: C, C♯, D, D♯, E. */
const cToE = (first: number, top: number): KeyBox[] => [
  white(first, 0, top),
  black(first + 1, 0, top),
  white(first + 2, 1, top),
  black(first + 3, 1, top),
  white(first + 4, 2, top),
];
/** The upper row first, as a page would list it; the lower 12 px below it. */
const LAYOUT = [...cToE(12, 0), ...cToE(0, 112)];

describe('keyAt', () => {
  it('finds the black key where it lies over a white, and the white elsewhere on it', () => {
    expect(keyAt({ x: 40, y: 30 }, LAYOUT)?.offset).toBe(13);
    expect(keyAt({ x: 35, y: 80 }, LAYOUT)?.offset).toBe(12);
    expect(keyAt({ x: 45, y: 80 }, LAYOUT)?.offset).toBe(14);
    expect(keyAt({ x: 10, y: 30 }, LAYOUT)?.offset).toBe(12);
    expect(keyAt({ x: 60, y: 30 }, LAYOUT)?.offset).toBe(14);
    expect(keyAt({ x: 60, y: 142 }, LAYOUT)?.offset).toBe(2);
  });

  it('finds nothing in the gap between rows or off the row', () => {
    expect(keyAt({ x: 60, y: 105 }, LAYOUT)).toBeNull();
    expect(keyAt({ x: 60, y: -1 }, LAYOUT)).toBeNull();
    expect(keyAt({ x: 121, y: 50 }, LAYOUT)).toBeNull();
    expect(keyAt({ x: 60, y: 213 }, LAYOUT)).toBeNull();
    expect(keyAt({ x: 60, y: 50 }, [])).toBeNull();
  });

  it('gives the same point a different key once the layout changes under it', () => {
    const moved = cToE(0, 0).map((key) => ({ ...key, left: key.left + 40, right: key.right + 40 }));
    expect(keyAt({ x: 60, y: 80 }, cToE(0, 0))?.offset).toBe(2);
    expect(keyAt({ x: 60, y: 80 }, moved)?.offset).toBe(0);
  });
});

describe('strikeVelocity', () => {
  const key = white(0, 0, 500);

  it('reads the floor at the top edge, halfway at the middle and full at the bottom edge', () => {
    expect(strikeVelocity({ x: 20, y: 500 }, key)).toBe(TOUCH_VELOCITY_FLOOR);
    expect(strikeVelocity({ x: 20, y: 550 }, key)).toBeCloseTo(0.8, 12);
    expect(strikeVelocity({ x: 20, y: 600 }, key)).toBe(TOUCH_VELOCITY_FULL);
    expect([TOUCH_VELOCITY_FLOOR, TOUCH_VELOCITY_FULL]).toEqual([0.6, 1]);
  });

  it('clamps a point outside the box to the range', () => {
    expect(strikeVelocity({ x: 20, y: 400 }, key)).toBe(0.6);
    expect(strikeVelocity({ x: 20, y: 700 }, key)).toBe(1);
  });

  it('reads a black key over its own height', () => {
    expect(strikeVelocity({ x: 40, y: 31 }, black(1, 0))).toBeCloseTo(0.8, 12);
  });
});

describe('the octaves a keys box shows', () => {
  it('is two when 14 white keys fit at 44 px, else one', () => {
    expect(octavesFor(616)).toBe(2);
    expect(octavesFor(615)).toBe(1);
    expect(octavesFor(292)).toBe(1);
    expect([keyCountFor(2), keyCountFor(1)]).toEqual([24, 12]);
  });

  it('counts the white keys, and places each black key after its white', () => {
    expect([whiteCount(24), whiteCount(12)]).toEqual([14, 7]);
    const blacks = Array.from({ length: 24 }, (_, offset) => offset).filter(isBlackKey);
    expect(blacks).toEqual([1, 3, 6, 8, 10, 13, 15, 18, 20, 22]);
    expect(blacks.map(afterWhite)).toEqual([0, 1, 3, 4, 5, 7, 8, 10, 11, 12]);
  });
});

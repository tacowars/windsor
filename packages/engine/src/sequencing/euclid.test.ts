import { describe, expect, it } from 'vitest';

import { euclid, patternFromString, patternToString, rotatePattern } from './euclid';

/** Toussaint's canonical forms (2005, "The Euclidean algorithm generates traditional musical rhythms"). */
const TABLE: ReadonlyArray<[number, number, string]> = [
  [1, 4, 'x...'],
  [2, 5, 'x.x..'],
  [3, 4, 'xxx.'],
  [3, 7, 'x.x.x..'],
  [3, 8, 'x..x..x.'],
  [4, 7, 'x.x.x.x'],
  [4, 9, 'x.x.x.x..'],
  [5, 8, 'x.xx.xx.'],
  [5, 9, 'x.x.x.x.x'],
  [5, 12, 'x..x.x..x.x.'],
  [5, 16, 'x..x..x..x..x...'],
  [7, 16, 'x..x.x.x..x.x.x.'],
];

describe('E(k, n)', () => {
  it.each(TABLE)('E(%i, %i) = %s', (k, n, expected) => {
    expect(patternToString(euclid(k, n))).toBe(expected);
  });

  it('handles k = 0 (silence) and k = n (every step)', () => {
    expect(patternToString(euclid(0, 8))).toBe('........');
    expect(patternToString(euclid(8, 8))).toBe('xxxxxxxx');
    expect(patternToString(euclid(0, 1))).toBe('.');
    expect(patternToString(euclid(1, 1))).toBe('x');
  });

  it('always places exactly k onsets on n steps, starting with one', () => {
    for (let n = 1; n <= 32; n++) {
      for (let k = 0; k <= n; k++) {
        const p = euclid(k, n);
        expect(p).toHaveLength(n);
        expect(p.filter(Boolean)).toHaveLength(k);
        if (k > 0) expect(p[0]).toBe(true);
      }
    }
  });

  it('rejects arguments outside the definition', () => {
    expect(() => euclid(-1, 8)).toThrow(RangeError);
    expect(() => euclid(9, 8)).toThrow(RangeError);
    expect(() => euclid(2, 0)).toThrow(RangeError);
    expect(() => euclid(1.5, 8)).toThrow(RangeError);
  });
});

describe('rotatePattern', () => {
  it('rotates right by the given steps, modulo the length', () => {
    const p = patternFromString('x..x..x.');
    expect(patternToString(rotatePattern(p, 1))).toBe('.x..x..x');
    expect(patternToString(rotatePattern(p, 8))).toBe('x..x..x.');
    expect(patternToString(rotatePattern(p, -1))).toBe('..x..x.x');
    expect(patternToString(euclid(3, 8, 2))).toBe('x.x..x..');
  });

  it('is what the rotate argument of euclid() applies', () => {
    for (let r = 0; r < 16; r++) {
      expect(euclid(5, 16, r)).toEqual(rotatePattern(euclid(5, 16), r));
    }
  });
});

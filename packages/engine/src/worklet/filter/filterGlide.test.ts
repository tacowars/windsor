import { describe, expect, it } from 'vitest';
import { FilterGlide, glidePiece, landGlide } from './filterGlide';

/** Each of `pieces` pieces' cutoff and Reso, gliding from (c0, r0) to (c1, r1). */
function pieces(c0: number, c1: number, r0: number, r1: number, count = 4) {
  const glide = new FilterGlide();
  glide.cutoffFrom = c0;
  glide.cutoffTo = c1;
  glide.resonanceFrom = r0;
  glide.resonanceTo = r1;
  return Array.from({ length: count }, (_, piece) => {
    glidePiece(glide, piece, count);
    return [glide.cutoff, glide.resonance] as const;
  });
}

describe('glidePiece', () => {
  it('moves the cutoff geometrically and the Reso linearly, landing on the new values', () => {
    const got = pieces(200, 8000, 1, 9);
    const ratio = 40 ** 0.25;
    got.slice(0, 3).forEach(([cutoff, reso], j) => {
      expect(cutoff).toBeCloseTo(200 * ratio ** (j + 1), 9);
      expect(reso).toBeCloseTo(1 + 2 * (j + 1), 12);
    });
    expect(got[3]).toEqual([8000, 9]);
  });

  it('holds a value that did not move exactly, in every piece', () => {
    expect(pieces(1234.5, 1234.5, 0.707, 0.707)).toEqual(Array(4).fill([1234.5, 0.707]));
  });

  it('glides down as it glides up', () => {
    const got = pieces(8000, 200, 9, 1);
    expect(got[1]![0]).toBeCloseTo(1264.911, 3);
    expect(got[1]![1]).toBe(5);
  });

  it('starts the next quantum where this one landed', () => {
    const glide = new FilterGlide();
    glide.cutoffFrom = 100;
    glide.cutoffTo = 400;
    glide.resonanceFrom = glide.resonanceTo = 2;
    landGlide(glide);
    expect([glide.cutoffFrom, glide.resonanceFrom]).toEqual([400, 2]);
    glidePiece(glide, 0, 4);
    expect(glide.cutoff).toBe(400);
  });
});

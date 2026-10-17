/**
 * The expanded keyboard view's picks (windsor#864, record
 * `2026-10-17-the-keyboard-on-a-tablet` decision 8), at the record's rooms:
 * 1318 px (landscape tablet), 976 px (portrait tablet), 342 px (390 px
 * phone) and 272 px (320 px phone), each the viewport less 2 × 24 px.
 */
import { describe, expect, it } from 'vitest';

import { VIEW_HINTS, VIEW_OCTAVES, VIEW_ROWS } from './keyboardConstants';
import type { KeysPick } from './keyboardConstants';
import {
  allows,
  normalizePick,
  octaveMaxFor,
  octavesWhyNot,
  rowPx,
  rowsFor,
  whiteKeyPx,
  whyNot,
} from './keyboardViewModel';

const LANDSCAPE = 1318;
const PORTRAIT = 976;
const PHONE = 342;
const SMALL_PHONE = 272;

/** Every pick a room allows, as `octaves×rows`. */
const allowed = (room: number): string[] =>
  VIEW_OCTAVES.flatMap((octaves) =>
    VIEW_ROWS.filter((rows) => allows(room, { octaves, rows })).map((rows) => `${octaves}×${rows}`),
  );

const pick = (octaves: number, rows: number): KeysPick => ({ octaves, rows });

describe('the expanded keyboard view', () => {
  it('allows every one-row pick in landscape, and 2 rows only for 2 and 4 octaves', () => {
    expect(allowed(LANDSCAPE)).toEqual(['1×1', '2×1', '2×2', '3×1', '4×1', '4×2']);
    expect(whiteKeyPx(LANDSCAPE, pick(4, 1))).toBeCloseTo(47.07, 2);
  });

  it('allows 4 octaves in portrait only in 2 rows', () => {
    expect(allows(PORTRAIT, pick(4, 1))).toBe(false);
    expect(allows(PORTRAIT, pick(4, 2))).toBe(true);
    expect(whiteKeyPx(PORTRAIT, pick(4, 2))).toBeCloseTo(69.71, 2);
    expect(whyNot(PORTRAIT, pick(4, 1))).toBe(VIEW_HINTS.needsTwoRows(4));
  });

  it('allows only 1 × 1 and 2 × 2 on a 342 px room, and only 1 × 1 on 272 px, under the minimum', () => {
    expect(allowed(PHONE)).toEqual(['1×1', '2×2']);
    expect(whiteKeyPx(PHONE, pick(2, 2))).toBeCloseTo(48.86, 2);
    expect(allowed(SMALL_PHONE)).toEqual(['1×1']);
    expect(whiteKeyPx(SMALL_PHONE, pick(1, 1))).toBeCloseTo(38.86, 2);
  });

  it('dims Rows 2 for 1 and 3 octaves, with its reason', () => {
    for (const octaves of [1, 3])
      expect(whyNot(LANDSCAPE, pick(octaves, 2))).toBe(VIEW_HINTS.evenRows);
  });

  it('gives an Octaves tap the rows it takes, and dims only a count no row count allows', () => {
    expect(rowsFor(PHONE, 2, 1)).toBe(2);
    expect(rowsFor(PORTRAIT, 4, 1)).toBe(2);
    expect(rowsFor(LANDSCAPE, 4, 1)).toBe(1);
    expect(rowsFor(LANDSCAPE, 3, 2)).toBe(1);
    expect(rowsFor(PHONE, 3, 1)).toBeNull();
    expect(octavesWhyNot(PHONE, 3, 1)).toBe(VIEW_HINTS.needsWidth(3));
    expect(octavesWhyNot(PHONE, 2, 1)).toBe('');
    expect(octavesWhyNot(SMALL_PHONE, 1, 1)).toBe('');
  });

  it('normalizes a pick the room does not allow: same rows with fewer octaves, then one row', () => {
    expect(normalizePick(PHONE, pick(2, 1))).toEqual(pick(1, 1));
    expect(normalizePick(LANDSCAPE, pick(2, 1))).toEqual(pick(2, 1));
    expect(normalizePick(PORTRAIT, pick(4, 1))).toEqual(pick(3, 1));
    expect(normalizePick(PHONE, pick(4, 2))).toEqual(pick(2, 2));
    expect(normalizePick(SMALL_PHONE, pick(4, 2))).toEqual(pick(1, 1));
  });

  it('splits the room’s height between two rows with the gap', () => {
    expect(rowPx(821, 1)).toBe(821);
    expect(rowPx(821, 2)).toBe(404.5);
    expect(rowPx(1163, 2)).toBe(575.5);
  });

  it('bounds the octave by the octaves shown: 8, 8, 7, 6, the highest key at most B9', () => {
    expect([1, 2, 3, 4].map((n) => octaveMaxFor(n))).toEqual([8, 8, 7, 6]);
    expect(12 * octaveMaxFor(4) + 12 * 4 - 1).toBe(119);
  });
});

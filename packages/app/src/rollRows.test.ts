/**
 * The Roll's rows (windsor#602 decision 4): 12, Scale with and without a
 * note on a row outside the scale, Fold, and which keys are named.
 */
import { describe, expect, it } from 'vitest';
import { keyNamed, rollRows, rowIndexAt, type RowInput } from './rollRows';

/** A minor's pitch classes: A B C D E F G. */
const A_MINOR = new Set([9, 11, 0, 2, 4, 5, 7]);

const input = (over: Partial<RowInput> = {}): RowInput => ({
  keys: '12',
  fold: false,
  rowPx: 7,
  used: new Set(),
  scalePcs: A_MINOR,
  panePx: 150,
  ...over,
});

const pitches = (rows: readonly { pitch: number }[]): number[] => rows.map((row) => row.pitch);

describe('rollRows', () => {
  it('12 shows every semitone from C7 down to C1, stacked at the zoom', () => {
    const { rows, height } = rollRows(input());
    expect(rows).toHaveLength(73);
    expect(rows[0]).toEqual({ pitch: 96, top: 0, h: 7, thin: false });
    expect(rows.at(-1)?.pitch).toBe(24);
    expect(height).toBe(73 * 7);
  });

  it('widens the range to a note outside C1 to C7', () => {
    const { rows } = rollRows(input({ used: new Set([12, 100]) }));
    expect(rows[0]?.pitch).toBe(100);
    expect(rows.at(-1)?.pitch).toBe(12);
  });

  it('Scale hides the five other rows of every octave', () => {
    const { rows } = rollRows(input({ keys: 'scale', used: new Set([57, 60, 64]) }));
    const octave = pitches(rows).filter((p) => p >= 60 && p < 72);
    expect(octave).toEqual([71, 69, 67, 65, 64, 62, 60]);
    expect(rows.every((row) => !row.thin)).toBe(true);
  });

  it('Scale keeps a row outside the scale that holds a note, as a 3 px sliver', () => {
    const { rows } = rollRows(input({ keys: 'scale', used: new Set([66]) }));
    const sharp = rows.find((row) => row.pitch === 66);
    expect(sharp).toMatchObject({ h: 3, thin: true });
    expect(rows.find((row) => row.pitch === 68)).toBeUndefined();
    const below = rows[rows.indexOf(sharp as (typeof rows)[number]) + 1];
    expect(below?.top).toBe((sharp?.top ?? 0) + 3);
  });

  it('Fold shows only the used pitches, high to low, as tall as the pane allows up to 16 px', () => {
    const used = new Set([60, 72, 64, 80]);
    expect(rollRows(input({ fold: true, used, keys: 'scale' })).rows).toEqual([
      { pitch: 80, top: 0, h: 16, thin: false },
      { pitch: 72, top: 16, h: 16, thin: false },
      { pitch: 64, top: 32, h: 16, thin: false },
      { pitch: 60, top: 48, h: 16, thin: false },
    ]);
    const many = new Set(Array.from({ length: 30 }, (_, i) => 40 + i));
    const folded = rollRows(input({ fold: true, used: many, panePx: 150 })).rows;
    expect(folded.map((row) => row.h)).toEqual(Array(30).fill(7));
  });

  it('Fold with no notes shows the Keys rows', () => {
    expect(rollRows(input({ fold: true })).rows).toHaveLength(73);
  });

  it('finds the row under a y, the last past the bottom', () => {
    const { rows } = rollRows(input({ fold: true, used: new Set([60, 62]) }));
    expect(rows[rowIndexAt(rows, 0)]?.pitch).toBe(62);
    expect(rows[rowIndexAt(rows, 17)]?.pitch).toBe(60);
    expect(rowIndexAt(rows, 999)).toBe(1);
  });
});

describe('keyNamed', () => {
  const row = (pitch: number, h: number, thin = false) => ({ pitch, top: 0, h, thin });

  it('names a key from 9 px, a C from 5 px, and never a sliver', () => {
    expect(keyNamed(row(62, 9))).toBe(true);
    expect(keyNamed(row(62, 7))).toBe(false);
    expect(keyNamed(row(60, 5))).toBe(true);
    expect(keyNamed(row(60, 3))).toBe(false);
    expect(keyNamed(row(61, 12, true))).toBe(false);
  });
});

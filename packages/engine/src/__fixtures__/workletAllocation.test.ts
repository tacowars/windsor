import { describe, expect, it } from 'vitest';
import { allocatedBytes, expectAllocationFree } from './workletAllocation';

const TOLERANCE_BYTES = 16 * 1024;
/** The leaky Phaser's reading in windsor#275: a drop in the first tenth, about 54 KB in each other. */
const LEAKY_PHASER = [-605120, ...Array<number>(9).fill(54000)];
/** A clean run: every tenth byte-identical and positive (the Phaser's 6 160 bytes). */
const CLEAN = Array<number>(10).fill(616);

describe('expectAllocationFree', () => {
  it('fails a leak whose plain total a drop in one tenth cancels', () => {
    const total = LEAKY_PHASER.reduce((sum, bytes) => sum + bytes, 0);
    expect(total).toBeLessThan(TOLERANCE_BYTES);
    expect(allocatedBytes(LEAKY_PHASER)).toBe(9 * 54000);
    expect(() => expectAllocationFree({ windows: LEAKY_PHASER, gcs: 0 }, TOLERANCE_BYTES)).toThrow(
      /by tenths: -605120 54000/,
    );
  });

  it('passes a clean run, whose clamped sum is its plain total', () => {
    expect(allocatedBytes(CLEAN)).toBe(6160);
    expect(() => expectAllocationFree({ windows: CLEAN, gcs: 0 }, TOLERANCE_BYTES)).not.toThrow();
  });

  it('fails a run with a collection in it', () => {
    expect(() => expectAllocationFree({ windows: CLEAN, gcs: 1 }, TOLERANCE_BYTES)).toThrow(
      /no collection ran/,
    );
  });
});

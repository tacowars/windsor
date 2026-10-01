/**
 * The Euclid card's ratchet row (windsor#356, decision 3): a click cycles a
 * step ×1 → ×2 → ×3 → ×4 → ×1, and a Steps change pads the row with 1 or
 * trims it, as the engine's normaliser fits it.
 */
import { describe, expect, it } from 'vitest';

import { EUCLID_RATCHET_MAX } from '@windsor/engine';
import { cycleRatchet, ratchetAt, ratchetsForSteps } from './euclidRatchetModel';

describe('the ratchet row', () => {
  it('cycles a step ×1 → ×2 → ×3 → ×4 → ×1', () => {
    let row: readonly number[] | undefined;
    const seen: number[] = [];
    for (let click = 0; click < EUCLID_RATCHET_MAX + 1; click++) {
      row = cycleRatchet(row, 4, 2);
      seen.push(row[2]!);
    }
    expect(seen).toEqual([2, 3, 4, 1, 2]);
    expect(row).toEqual([1, 1, 2, 1]);
  });

  it('writes the whole row at the step count, with no row before it all ×1', () => {
    expect(cycleRatchet(undefined, 3, 0)).toEqual([2, 1, 1]);
    // A row shorter than the steps (a Steps edit not yet carried) is padded.
    expect(cycleRatchet([3], 4, 3)).toEqual([3, 1, 1, 2]);
  });

  it('reads a step past the row, or no row, as a plain hit', () => {
    expect(ratchetAt(undefined, 5)).toBe(1);
    expect(ratchetAt([2, 3], 1)).toBe(3);
    expect(ratchetAt([2, 3], 4)).toBe(1);
  });

  it('pads with 1 and trims to a step count', () => {
    expect(ratchetsForSteps([2, 3], 4)).toEqual([2, 3, 1, 1]);
    expect(ratchetsForSteps([2, 3, 4, 2], 2)).toEqual([2, 3]);
  });
});

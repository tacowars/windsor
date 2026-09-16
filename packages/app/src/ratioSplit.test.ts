/**
 * The Coarse / Fine model (#587). Two things matter here and neither needs a
 * browser: that every ratio already in the library survives being taken apart
 * and put back together **exactly**, and that a knob moves only its own half
 * and never carries into the other's.
 */
import { describe, expect, it } from 'vitest';

import { PATCH_LIBRARY } from '../../../packages/client/src/audio/index-for-editor';
import {
  COARSE_MAX,
  FINE_MAX,
  RATIO_MAX,
  RATIO_MIN,
  fmtCoarse,
  fmtFine,
  fmtRatio,
  join,
  split,
  withCoarse,
  withFine,
} from './ratioSplit';

/** Every ratio the shipped bank actually uses, active operators included. */
function libraryRatios(): number[] {
  const ratios: number[] = [];
  for (const entry of Object.values(PATCH_LIBRARY)) {
    for (const operator of entry.patch.ops) ratios.push(operator.ratio);
  }
  return ratios;
}

describe('splitting a stored ratio', () => {
  it('takes the whole part as Coarse and the remainder as Fine', () => {
    expect(split(1)).toEqual({ coarse: 1, fine: 0 });
    expect(split(2.5)).toEqual({ coarse: 2, fine: 0.5 });
    expect(split(0.25)).toEqual({ coarse: 0, fine: 0.25 });
    expect(split(0.5)).toEqual({ coarse: 0, fine: 0.5 });
    expect(split(RATIO_MAX)).toEqual({ coarse: COARSE_MAX, fine: 0 });
  });

  it('round-trips every ratio in the library bit for bit', () => {
    const ratios = libraryRatios();
    // A guard on the survey itself: an empty list would pass vacuously.
    expect(ratios.length).toBeGreaterThan(100);
    const broken = ratios.filter((r) => {
      const { coarse, fine } = split(r);
      return !Object.is(join(coarse, fine), r);
    });
    expect(broken).toEqual([]);
  });

  it('round-trips the awkward doubles the library actually holds', () => {
    // 5.242900000000001 is a real stored value: `floor` then subtraction is
    // exact for these, so the console cannot quietly re-round a patch on load.
    for (const r of [5.242900000000001, 17.1, 2.414, 1.41, 2.718, 0.707, 0.75, 4.251, 11.3]) {
      const { coarse, fine } = split(r);
      expect(Object.is(join(coarse, fine), r), String(r)).toBe(true);
    }
  });

  it("keeps the joined value inside the stored field's range", () => {
    expect(join(COARSE_MAX, FINE_MAX)).toBe(RATIO_MAX);
    expect(join(0, 0)).toBe(RATIO_MIN);
  });
});

describe('turning one knob of the pair', () => {
  it('moves Coarse and keeps Fine', () => {
    expect(withCoarse(1.5, 2)).toBe(2.5);
    expect(withCoarse(2.5, 1)).toBe(1.5);
    expect(withCoarse(3.25, 7)).toBe(7.25);
  });

  it('moves Fine and keeps Coarse', () => {
    expect(withFine(2.5, 0)).toBe(2);
    expect(withFine(2, 0.5)).toBe(2.5);
  });

  it('never carries Fine into the next whole step', () => {
    // The knob's own max is 0.999; asking for more stays there and Coarse
    // does not move, so no knob jumps a whole multiple by itself.
    expect(withFine(2.999, 1)).toBe(2.999);
    expect(withFine(2.999, FINE_MAX)).toBe(2.999);
    expect(split(withFine(2.999, 5)).coarse).toBe(2);
  });

  it('clamps to the range at both ends', () => {
    expect(withCoarse(0.25, 0)).toBe(RATIO_MIN);
    expect(withFine(0.5, 0.25)).toBe(0.25);
    // Coarse 0 is where the sub-ratios live, and 0.1 is below the floor.
    expect(withFine(0.5, 0.1)).toBe(RATIO_MIN);
    // Coarse below its own floor is 0, which leaves the sub-ratio standing.
    expect(withCoarse(0.5, -3)).toBe(0.5);
    expect(withCoarse(12.5, 99)).toBe(RATIO_MAX);
  });

  it('rounds a Coarse position to a whole multiple', () => {
    expect(withCoarse(1.25, 3.4)).toBe(3.25);
  });
});

describe('what the bay shows', () => {
  it('names Coarse 0 as the sub-ratio band and the rest as integers', () => {
    expect(fmtCoarse(0)).toBe('sub');
    expect(fmtCoarse(1)).toBe('1');
    expect(fmtCoarse(24)).toBe('24');
  });

  it('shows Fine and the combined ratio to three decimals', () => {
    expect(fmtFine(0.5)).toBe('0.500');
    expect(fmtRatio(1.5)).toBe('1.500');
    expect(fmtRatio(2)).toBe('2.000');
  });
});

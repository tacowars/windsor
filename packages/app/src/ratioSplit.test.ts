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
  COARSE_MIN,
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
    // A guard on the survey itself: an empty list would pass vacuously. It is
    // deliberately not a count of today's bank — the bank is data, and a
    // smaller one is not this test failing.
    expect(ratios.length).toBeGreaterThan(0);
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

  it('splits and joins at the floor and in the band the old floor cut off (#618 decision 7)', () => {
    // The floor itself: Coarse 0, Fine the whole value, and back exactly.
    expect(split(RATIO_MIN)).toEqual({ coarse: 0, fine: RATIO_MIN });
    expect(join(0, RATIO_MIN)).toBe(RATIO_MIN);
    // Between the new floor and the drum bodies' 0.25: a sub-body an octave
    // under the kick. Written from the constant, so a lower floor keeps it.
    const between = RATIO_MIN * 2;
    expect(between).toBeLessThan(0.25);
    expect(split(between)).toEqual({ coarse: 0, fine: between });
    expect(join(0, between)).toBe(between);
    expect(withFine(0.5, between)).toBe(between);
    // Below the floor still clamps, so the console never writes a ratio it cannot show.
    expect(join(0, RATIO_MIN / 2)).toBe(RATIO_MIN);
    // The readout shows the floor in the stored field's own terms.
    expect(fmtRatio(RATIO_MIN)).toBe(RATIO_MIN.toFixed(3));
    expect(fmtCoarse(split(RATIO_MIN).coarse)).toBe('sub');
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
    // Fine stops at its own maximum; asking for more stays there and Coarse
    // does not move, so no knob jumps a whole multiple by itself. The
    // expectation is written from the constant, not from today's 0.999.
    const top = 2 + FINE_MAX;
    expect(withFine(top, 1)).toBe(top);
    expect(withFine(top, FINE_MAX)).toBe(top);
    expect(split(withFine(top, 5)).coarse).toBe(2);
  });

  it('never carries a whole step when Coarse is turned', () => {
    // A stored ratio a hair under a whole number holds a fraction the pair
    // cannot represent, and adding it to the requested coarse would round
    // past that coarse and zero Fine (Codex pass 1, P2). `1 - EPSILON / 2` is
    // the largest double below 1, and no knob can produce it — a hand-written
    // or imported document can. Checked over the whole Coarse range:
    const nearlyWhole = 1 - Number.EPSILON / 2;
    for (let coarse = COARSE_MIN; coarse <= COARSE_MAX; coarse++) {
      const turned = withCoarse(nearlyWhole, coarse);
      expect(split(turned).coarse, `coarse ${coarse}`).toBe(coarse);
      expect(turned, `coarse ${coarse}`).toBeLessThan(coarse + 1);
    }
  });

  it('clamps to the range at both ends', () => {
    expect(withCoarse(RATIO_MIN, 0)).toBe(RATIO_MIN);
    expect(withFine(0.5, 0.25)).toBe(0.25);
    // Coarse 0 is where the sub-ratios live, and half the floor is below it.
    expect(withFine(0.5, RATIO_MIN / 2)).toBe(RATIO_MIN);
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

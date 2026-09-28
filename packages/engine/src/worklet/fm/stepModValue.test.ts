/**
 * The step modulation curve (windsor#17): 0 is the patch's value exactly, a
 * value moves the base in its row's curve space, and the result clamps to
 * the row's bounds.
 */
import { describe, expect, it } from 'vitest';

import type { StepModRow } from './stepModTables';
import { STEP_MOD_TABLE } from './stepModTables';
import { stepModValue } from './stepModValue';

const row = (param: string): StepModRow => STEP_MOD_TABLE.find((r) => r.param === param)!;
const CUTOFF = row('filter.cutoff');
const DECAY = row('ops.0.env.decayTime');
const LEVEL = row('ops.1.level');

describe('stepModValue', () => {
  it('hands back the base untouched at 0, even outside the row’s bounds', () => {
    expect(stepModValue(CUTOFF, 8000, 0)).toBe(8000);
    expect(stepModValue(CUTOFF, 20000, 0)).toBe(20000);
    expect(stepModValue(LEVEL, 0.3, -0)).toBe(0.3);
  });

  it('adds a linear span', () => {
    expect(stepModValue(LEVEL, 0.3, 0.5)).toBeCloseTo(0.3 + 0.5 * LEVEL.span, 12);
    expect(stepModValue(LEVEL, 0.8, -1)).toBeCloseTo(0.8 - LEVEL.span, 12);
  });

  it('moves the cutoff in octaves: +0.5 is half the span up', () => {
    const moved = stepModValue(CUTOFF, 1000, 0.5);
    expect(Math.log2(moved / 1000)).toBeCloseTo(CUTOFF.span / 2, 12);
  });

  it('moves a time along the knob’s log curve: +0.5 is half `span` of its travel', () => {
    const moved = stepModValue(DECAY, 0.01, 0.5);
    const travel = Math.log(DECAY.max / DECAY.min);
    expect(Math.log(moved / 0.01) / travel).toBeCloseTo(DECAY.span / 2, 12);
  });

  it('clamps: +1 at the max stays at the max, -1 at the min stays at the min', () => {
    for (const r of STEP_MOD_TABLE) {
      expect(stepModValue(r, r.max, 1), r.param).toBe(r.max);
      expect(stepModValue(r, r.min, -1), r.param).toBe(r.min);
    }
  });
});

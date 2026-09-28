/**
 * The step modulation table (windsor#17): the nine first-cut parameters in
 * slot order, the slot constants the voice addresses them by, and bounds
 * that mirror the patch's own clamps.
 */
import { describe, expect, it } from 'vitest';

import { FEEDBACK_RANGE, OPERATOR_COUNT, WIDTH_RANGE } from './patchDefaults';
import {
  STEP_MOD_LANES_MAX,
  STEP_MOD_PARAMS,
  STEP_MOD_SLOT_COUNT,
  STEP_MOD_TABLE,
  STEP_OP_DECAY,
  STEP_OP_DECAY_CURVE,
  STEP_OP_FEEDBACK,
  STEP_OP_LEVEL,
  STEP_OP_WIDTH,
  STEP_SLOT_CUTOFF,
  STEP_SLOT_ENV_AMOUNT,
  STEP_SLOT_FILTER_DECAY,
  STEP_SLOT_OP_BASE,
  STEP_SLOT_OP_STRIDE,
  STEP_SLOT_RESONANCE,
} from './stepModTables';

const row = (param: string) => STEP_MOD_TABLE.find((r) => r.param === param);

describe('the step modulation table (windsor#17)', () => {
  it('has four filter rows and five per operator, each parameter once', () => {
    expect(STEP_MOD_SLOT_COUNT).toBe(4 + 5 * OPERATOR_COUNT);
    expect(STEP_MOD_PARAMS).toHaveLength(STEP_MOD_SLOT_COUNT);
    expect(new Set(STEP_MOD_PARAMS).size).toBe(STEP_MOD_SLOT_COUNT);
    expect(STEP_MOD_LANES_MAX).toBe(4);
  });

  it('puts every row at the slot the voice reads it from', () => {
    expect(STEP_MOD_PARAMS[STEP_SLOT_ENV_AMOUNT]).toBe('filter.envAmount');
    expect(STEP_MOD_PARAMS[STEP_SLOT_CUTOFF]).toBe('filter.cutoff');
    expect(STEP_MOD_PARAMS[STEP_SLOT_RESONANCE]).toBe('filter.resonance');
    expect(STEP_MOD_PARAMS[STEP_SLOT_FILTER_DECAY]).toBe('filter.env.decayTime');
    for (let i = 0; i < OPERATOR_COUNT; i++) {
      const base = STEP_SLOT_OP_BASE + i * STEP_SLOT_OP_STRIDE;
      expect(STEP_MOD_PARAMS[base + STEP_OP_LEVEL]).toBe(`ops.${i}.level`);
      expect(STEP_MOD_PARAMS[base + STEP_OP_DECAY]).toBe(`ops.${i}.env.decayTime`);
      expect(STEP_MOD_PARAMS[base + STEP_OP_DECAY_CURVE]).toBe(`ops.${i}.env.decayCurve`);
      expect(STEP_MOD_PARAMS[base + STEP_OP_FEEDBACK]).toBe(`ops.${i}.feedback`);
      expect(STEP_MOD_PARAMS[base + STEP_OP_WIDTH]).toBe(`ops.${i}.width`);
    }
  });

  it('gives every row a positive span and a range, on a positive floor for a curve', () => {
    for (const r of STEP_MOD_TABLE) {
      expect(r.span, r.param).toBeGreaterThan(0);
      expect(r.max, r.param).toBeGreaterThan(r.min);
      if (r.curve !== 'linear') expect(r.min, r.param).toBeGreaterThan(0);
    }
  });

  it('bounds feedback and width by the clamps the worklet applies to the patch', () => {
    for (let i = 0; i < OPERATOR_COUNT; i++) {
      expect(row(`ops.${i}.feedback`)).toMatchObject({ curve: 'linear', ...FEEDBACK_RANGE });
      expect(row(`ops.${i}.width`)).toMatchObject({ curve: 'linear', span: 0.5, ...WIDTH_RANGE });
    }
  });

  it('works the cutoff in octaves and the times along the knob’s log curve', () => {
    expect(row('filter.cutoff')?.curve).toBe('octaves');
    expect(row('filter.env.decayTime')?.curve).toBe('log');
    expect(row('ops.2.env.decayTime')?.curve).toBe('log');
    expect(row('filter.resonance')?.curve).toBe('linear');
  });

  it('keeps the old offsets on a slide only for the decay curve and feedback', () => {
    const kept = STEP_MOD_TABLE.filter((r) => r.slideKeeps).map((r) => r.param);
    const expected = Array.from({ length: OPERATOR_COUNT }, (_, i) => [
      `ops.${i}.env.decayCurve`,
      `ops.${i}.feedback`,
    ]).flat();
    expect(kept).toEqual(expected);
  });
});

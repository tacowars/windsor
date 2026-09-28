/**
 * Step modulation lanes (windsor#17): the offsets a step sends, one slot per
 * table row, and nothing for a step every lane leaves at 0.
 */
import { describe, expect, it } from 'vitest';

import { STEP_MOD_PARAMS, STEP_MOD_SLOT_COUNT } from '../worklet/fm/stepModTables';
import { assertStepModLanes, isStepModParam, stepModAt, type StepModLane } from './stepModLanes';

const LANES: StepModLane[] = [
  { param: 'filter.cutoff', values: [0, 0.5, 0] },
  { param: 'ops.3.width', values: [0, -0.25, 1] },
];

describe('stepModAt', () => {
  it('fills each lane’s slot with its value on the step, the rest 0', () => {
    const at = stepModAt(LANES, 1)!;
    expect(at).toHaveLength(STEP_MOD_SLOT_COUNT);
    expect(at[STEP_MOD_PARAMS.indexOf('filter.cutoff')]).toBe(0.5);
    expect(at[STEP_MOD_PARAMS.indexOf('ops.3.width')]).toBe(-0.25);
    expect(at.filter((v) => v !== 0)).toHaveLength(2);
    expect(stepModAt(LANES, 2)![STEP_MOD_PARAMS.indexOf('ops.3.width')]).toBe(1);
  });

  it('is nothing for no lanes, a step every lane leaves at 0, or a step past a lane’s end', () => {
    expect(stepModAt([], 0)).toBeUndefined();
    expect(stepModAt(LANES, 0)).toBeUndefined();
    expect(stepModAt(LANES, 7)).toBeUndefined();
  });
});

describe('the lane checks', () => {
  it('knows the table’s parameters and nothing else', () => {
    expect(STEP_MOD_PARAMS.every(isStepModParam)).toBe(true);
    expect(isStepModParam('volume')).toBe(false);
    expect(isStepModParam(undefined)).toBe(false);
  });

  it('accepts the lanes a normalised document carries', () => {
    expect(() => assertStepModLanes(LANES)).not.toThrow();
    expect(() => assertStepModLanes([])).not.toThrow();
  });

  it('refuses a value outside -1..1, and NaN', () => {
    const param = 'filter.cutoff' as const;
    expect(() => assertStepModLanes([{ param, values: [-1.01] }])).toThrow(RangeError);
    expect(() => assertStepModLanes([{ param, values: [Number.NaN] }])).toThrow(RangeError);
  });
});

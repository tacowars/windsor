/**
 * Step modulation lanes (windsor#17): the offsets a step sends, one slot per
 * table row, and nothing for a step every lane leaves at 0.
 */
import { describe, expect, it } from 'vitest';

import { STEP_MOD_PARAMS, STEP_MOD_SLOT_COUNT } from '../worklet/fm/stepModTables';
import {
  assertStepModLanes,
  isStepModParam,
  stepModAt,
  stepModAtCycle,
  type StepModLane,
} from './stepModLanes';

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

describe('stepModAtCycle (windsor#355)', () => {
  const CYCLED: StepModLane[] = [
    { param: 'ops.3.width', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.75] },
    { param: 'filter.cutoff', values: [0, 0.5, 0, 0, 0] },
  ];

  it('reads each lane at the local step mod its own length, in slot order', () => {
    for (let local = 0; local < 50; local++) {
      const at = stepModAtCycle(CYCLED, local);
      const cutoff = CYCLED[1]!.values[local % 5]!;
      const width = CYCLED[0]!.values[local % 10]!;
      if (cutoff === 0 && width === 0) {
        expect(at, `local ${local}`).toBeUndefined();
        continue;
      }
      expect(at).toHaveLength(STEP_MOD_SLOT_COUNT);
      expect(at?.[STEP_MOD_PARAMS.indexOf('filter.cutoff')]).toBe(cutoff);
      expect(at?.[STEP_MOD_PARAMS.indexOf('ops.3.width')]).toBe(width);
    }
  });

  it('is nothing for no lanes or an empty one, and the grid’s read is unchanged', () => {
    expect(stepModAtCycle([], 3)).toBeUndefined();
    expect(stepModAtCycle([{ param: 'filter.cutoff', values: [] }], 3)).toBeUndefined();
    expect(stepModAt(LANES, 7)).toBeUndefined();
    expect(stepModAtCycle(LANES, 7)).toEqual(stepModAt(LANES, 1));
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

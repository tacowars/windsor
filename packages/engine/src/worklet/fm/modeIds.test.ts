/**
 * The mode ids (#669) are one set: `patch.ts` re-exports the worklet's
 * objects rather than spelling its own numbers, and the console's name lists
 * name every id in order.
 */
import { describe, expect, it } from 'vitest';

import {
  FILTER_MODE as MAIN_FILTER_MODE,
  FILTER_MODE_NAMES,
  LFO_SHAPE as MAIN_LFO_SHAPE,
  LFO_SHAPE_NAMES,
  LOOP_MODE as MAIN_LOOP_MODE,
  LOOP_MODE_NAMES,
} from '../../patch/patch';
import {
  FILT_NOTCH,
  FILT_OFF,
  FILTER_MODE,
  LFO_DRIFT,
  LFO_SHAPE,
  LFO_SINE,
  LOOP_MODE,
  LOOP_NONE,
  LOOP_TRIGGER,
} from './modeIds';

describe('mode ids', () => {
  it('patch.ts re-exports the worklet objects, not a copy', () => {
    expect(MAIN_LOOP_MODE).toBe(LOOP_MODE);
    expect(MAIN_FILTER_MODE).toBe(FILTER_MODE);
    expect(MAIN_LFO_SHAPE).toBe(LFO_SHAPE);
  });

  it('builds each object from the scalars the DSP switches on', () => {
    expect([LOOP_MODE.NONE, LOOP_MODE.TRIGGER]).toEqual([LOOP_NONE, LOOP_TRIGGER]);
    expect([FILTER_MODE.OFF, FILTER_MODE.NOTCH]).toEqual([FILT_OFF, FILT_NOTCH]);
    expect([LFO_SHAPE.SINE, LFO_SHAPE.DRIFT]).toEqual([LFO_SINE, LFO_DRIFT]);
  });

  it('numbers each set densely from zero, one console name per id', () => {
    const sets: [Record<string, number>, readonly string[]][] = [
      [LOOP_MODE, LOOP_MODE_NAMES],
      [FILTER_MODE, FILTER_MODE_NAMES],
      [LFO_SHAPE, LFO_SHAPE_NAMES],
    ];
    for (const [ids, names] of sets) {
      const values = Object.values(ids);
      expect(values).toEqual(values.map((_, i) => i));
      expect(names).toHaveLength(values.length);
    }
  });
});

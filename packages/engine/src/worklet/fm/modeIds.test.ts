/**
 * The mode ids (#669) are one set: `patch.ts` re-exports the worklet's
 * objects rather than spelling its own numbers, and the console's name lists
 * name every id in order.
 */
import { describe, expect, it } from 'vitest';

import {
  DRIVE_SHAPE as MAIN_DRIVE_SHAPE,
  DRIVE_SHAPE_NAMES,
  FILTER_MODE as MAIN_FILTER_MODE,
  FILTER_MODE_NAMES,
  LFO_SHAPE as MAIN_LFO_SHAPE,
  LFO_SHAPE_NAMES,
  LOOP_MODE as MAIN_LOOP_MODE,
  LOOP_MODE_NAMES,
  MACRO_CURVE as MAIN_MACRO_CURVE,
  MACRO_CURVE_NAMES,
} from '../../patch/patch';
import {
  DRIVE_FOLD,
  DRIVE_SHAPE,
  DRIVE_SOFT,
  FILT_FORMANT,
  FILT_LADDER,
  FILT_NOTCH,
  FILT_OFF,
  FILTER_MODE,
  LFO_DRIFT,
  LFO_SHAPE,
  LFO_SINE,
  LOOP_MODE,
  LOOP_NONE,
  LOOP_TRIGGER,
  MACRO_CURVE,
  MACRO_LINEAR,
  MACRO_S,
} from './modeIds';

describe('mode ids', () => {
  it('patch.ts re-exports the worklet objects, not a copy', () => {
    expect(MAIN_LOOP_MODE).toBe(LOOP_MODE);
    expect(MAIN_FILTER_MODE).toBe(FILTER_MODE);
    expect(MAIN_LFO_SHAPE).toBe(LFO_SHAPE);
    expect(MAIN_DRIVE_SHAPE).toBe(DRIVE_SHAPE);
    expect(MAIN_MACRO_CURVE).toBe(MACRO_CURVE);
  });

  it('builds each object from the scalars the DSP switches on', () => {
    expect([LOOP_MODE.NONE, LOOP_MODE.TRIGGER]).toEqual([LOOP_NONE, LOOP_TRIGGER]);
    expect([FILTER_MODE.OFF, FILTER_MODE.NOTCH]).toEqual([FILT_OFF, FILT_NOTCH]);
    // windsor#331: Formant is the sixth mode, last in the console's list.
    expect(FILTER_MODE.FORMANT).toBe(FILT_FORMANT);
    expect(FILTER_MODE_NAMES[FILT_FORMANT]).toBe('Formant');
    // windsor#573: Acid, the diode ladder, is the seventh, after it.
    expect(FILTER_MODE.LADDER).toBe(FILT_LADDER);
    expect(FILT_LADDER).toBe(6);
    expect(FILTER_MODE_NAMES[FILT_LADDER]).toBe('Acid');
    expect([LFO_SHAPE.SINE, LFO_SHAPE.DRIFT]).toEqual([LFO_SINE, LFO_DRIFT]);
    expect([DRIVE_SHAPE.SOFT, DRIVE_SHAPE.FOLD]).toEqual([DRIVE_SOFT, DRIVE_FOLD]);
    expect([MACRO_CURVE.LINEAR, MACRO_CURVE.S]).toEqual([MACRO_LINEAR, MACRO_S]);
  });

  it('numbers each set densely from zero, one console name per id', () => {
    const sets: [Record<string, number>, readonly string[]][] = [
      [LOOP_MODE, LOOP_MODE_NAMES],
      [FILTER_MODE, FILTER_MODE_NAMES],
      [LFO_SHAPE, LFO_SHAPE_NAMES],
      [DRIVE_SHAPE, DRIVE_SHAPE_NAMES],
      [MACRO_CURVE, MACRO_CURVE_NAMES],
    ];
    for (const [ids, names] of sets) {
      const values = Object.values(ids);
      expect(values).toEqual(values.map((_, i) => i));
      expect(names).toHaveLength(values.length);
    }
  });
});

/**
 * The mixer knobs' ranges (windsor#443): the strip knobs take their bounds
 * from the catalog's strip rows and the group knobs spread them, so this
 * pins every range and default where a row edit would show.
 */
import { describe, expect, it } from 'vitest';
import { RETURN_NAMES } from '@windsor/engine';
import {
  GROUP_LEVEL_KNOB,
  GROUP_PAN_KNOB,
  STRIP_LEVEL_KNOB,
  STRIP_LEVEL_MAX,
  STRIP_PAN_KNOB,
  sendKnob,
} from './mixerTables';
import type { CardKnobSpec } from './sequencerKnobTables';

const range = (knob: CardKnobSpec): readonly number[] => [knob.min, knob.max, knob.def];

describe('the mixer knobs', () => {
  it('keep their ranges and defaults', () => {
    expect(STRIP_LEVEL_MAX).toBe(2);
    expect(range(STRIP_LEVEL_KNOB)).toEqual([0, 2, 1]);
    expect(range(STRIP_PAN_KNOB)).toEqual([-1, 1, 0]);
    for (const ret of RETURN_NAMES) expect(range(sendKnob(ret))).toEqual([0, 1, 0]);
    expect(range(GROUP_LEVEL_KNOB)).toEqual([0, 2, 1]);
    expect(range(GROUP_PAN_KNOB)).toEqual([-1, 1, 0]);
  });
});

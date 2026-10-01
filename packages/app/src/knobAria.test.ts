/**
 * A knob's slider attributes (windsor#246, Codex P1 on PR #251): the
 * `aria-valuetext` a screen reader announces is the visible readout, while
 * `aria-valuenow` stays the raw stored value. `makeKnob` sets both from
 * `knobAria`, so the pure function is the seam tested here.
 */
import { describe, expect, it } from 'vitest';

import { TAPE_BOUNDS } from '@windsor/engine';
import { knobAria } from './knob';
import { TAPE_KNOBS } from './tapeTables';

const drive = TAPE_KNOBS.find((k) => k.f === 'drive')!;

describe('knobAria', () => {
  it('announces Tape Drive as its signed dB readout at the endpoints and centre', () => {
    const [min, max] = TAPE_BOUNDS.drive;
    expect(knobAria(drive.o, min).valuetext).toBe('-12.0 dB');
    expect(knobAria(drive.o, 0).valuetext).toBe('0.0 dB');
    expect(knobAria(drive.o, max).valuetext).toBe('+12.0 dB');
  });

  it('keeps aria-valuenow the raw stored value', () => {
    const max = TAPE_BOUNDS.drive[1];
    expect(knobAria(drive.o, max).valuenow).toBe(String(max));
    expect(knobAria(drive.o, 0).valuenow).toBe('0');
  });

  it('reads an unformatted knob to two decimals', () => {
    expect(knobAria({}, 0.5)).toEqual({ valuenow: '0.5', valuetext: '0.50' });
  });
});

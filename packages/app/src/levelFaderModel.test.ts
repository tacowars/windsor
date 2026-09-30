/**
 * The Level fader's mapping (windsor#194 decision 6): its travel is the meter
 * scale, the bottom is −∞, the top is the knob's maximum, and the song keeps
 * the same linear level the knob stored.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MASTER } from '@windsor/engine';

import {
  faderDragLevel,
  faderKeyLevel,
  faderLevel,
  faderPosition,
  faderReadout,
  faderValueText,
} from './levelFaderModel';
import { MASTER_LEVEL_FADER } from './masterTables';
import { meterPosition } from './meterModel';
import { STRIP_LEVEL_MAX } from './mixerTables';

describe('the fader’s travel', () => {
  it('puts −∞ at the bottom, the knob’s maximum at the top, and 0 dB on the meter scale', () => {
    expect(faderPosition(0)).toBe(0);
    expect(faderLevel(0)).toBe(0);
    expect(faderLevel(1)).toBe(STRIP_LEVEL_MAX);
    expect(faderPosition(1)).toBeCloseTo(meterPosition(0), 12);
    expect(faderPosition(STRIP_LEVEL_MAX)).toBe(1);
  });

  it('stores the linear level the knob did, over the same range and default', () => {
    expect(MASTER_LEVEL_FADER.max).toBe(STRIP_LEVEL_MAX);
    expect(MASTER_LEVEL_FADER.def).toBe(DEFAULT_MASTER.level);
    for (const level of [0.002, 0.05, 0.5, 1, 1.5, 1.99]) {
      expect(faderLevel(faderPosition(level))).toBeCloseTo(level, 9);
    }
  });

  it('clamps past either end, and a stored level past the top sits at the top', () => {
    expect(faderLevel(-0.5)).toBe(0);
    expect(faderLevel(1.5)).toBe(STRIP_LEVEL_MAX);
    expect(faderPosition(4)).toBe(1);
  });
});

describe('the fader’s gestures', () => {
  it('follows the pointer on a drag, and moves slower under Shift', () => {
    const start = faderPosition(1);
    const up = faderDragLevel({ startPosition: start, dyPx: -21, heightPx: 210, fine: false });
    expect(faderPosition(up)).toBeCloseTo(start + 0.1, 9);
    const fine = faderDragLevel({ startPosition: start, dyPx: -21, heightPx: 210, fine: true });
    expect(faderPosition(fine)).toBeCloseTo(start + 0.1 / MASTER_LEVEL_FADER.fineFactor, 9);
  });

  it('steps a share of the travel per arrow key, finer under Shift', () => {
    const start = faderPosition(1);
    expect(faderPosition(faderKeyLevel(1, 1, false))).toBeCloseTo(
      start + MASTER_LEVEL_FADER.keyStep,
      9,
    );
    expect(faderPosition(faderKeyLevel(1, -1, true))).toBeCloseTo(
      start - MASTER_LEVEL_FADER.keyStepFine,
      9,
    );
    expect(faderKeyLevel(0, -1, false)).toBe(0);
    expect(faderKeyLevel(STRIP_LEVEL_MAX, 1, false)).toBe(STRIP_LEVEL_MAX);
  });
});

describe('the fader’s readout', () => {
  it('reads dB with a sign, and −∞ at the bottom', () => {
    expect(faderReadout(1)).toBe('0.0');
    expect(faderReadout(STRIP_LEVEL_MAX)).toBe('+6.0');
    expect(faderReadout(0.5)).toBe('−6.0');
    expect(faderReadout(0)).toBe('−∞');
    expect(faderValueText(0.5)).toBe('−6.0 dB');
  });
});

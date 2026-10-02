/**
 * The Euclid device's tables (windsor#393 decisions 4 and 5): every Play
 * knob stands in one column in the mockup's order, and the rows held at the
 * top of the scroller leave room for three lanes in the device's one
 * height, so nothing scrolls until a fourth is added.
 */
import { STEP_MOD_LANES_MAX } from '@windsor/engine';
import { describe, expect, it } from 'vitest';

import { EUCLID_KNOB_COLUMNS, EUCLID_LANES_MAX } from './euclidConstants';
import {
  EUCLID_ROW_GAP_PX,
  EUCLID_ROW_PX,
  EUCLID_RULE_PX,
  SEQUENCER_DEVICE_PX,
  euclidHeadPx,
} from './sequencerDeviceTables';
import { EUCLID_ACCENT_KNOBS, EUCLID_KNOBS } from './sequencerKnobTables';

const px = (prop: string): number => {
  const value = SEQUENCER_DEVICE_PX[prop];
  if (value === undefined) throw new Error(`no ${prop}`);
  return value;
};

describe('the Euclid device’s Play columns (windsor#393 decision 4)', () => {
  it('stands every Euclid table knob in exactly one column', () => {
    const placed = EUCLID_KNOB_COLUMNS.flat();
    const tabled = [...EUCLID_KNOBS, ...EUCLID_ACCENT_KNOBS].map((entry) => entry.f);
    expect([...placed].sort()).toEqual([...tabled].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('puts Vel, Acc vel and Acc mod together, then Hold', () => {
    expect(EUCLID_KNOB_COLUMNS).toEqual([['velocity', 'accentVelocity', 'accentMod'], ['hold']]);
  });
});

describe('the Euclid rows’ height (decision 5)', () => {
  /** The rows' room: the device less its border, the tabs, the section's padding and its label. */
  const room = px('--seq-h') - 2 - 20 - 4 - 6 - 14;
  /** The held rows, `n` lanes under them, and the ring's room under the last. */
  const rows = (n: number): number =>
    euclidHeadPx() + n * (px('--lane-h') + EUCLID_ROW_GAP_PX) + EUCLID_ROW_GAP_PX;

  it('holds the ratchet row, the trigger row and the Lanes rule, as the properties size them', () => {
    expect(px('--euclid-ratchet-h')).toBe(EUCLID_ROW_PX.ratchet);
    expect(px('--euclid-trigger-h')).toBe(EUCLID_ROW_PX.trigger);
    expect(px('--euclid-rule-h')).toBe(EUCLID_RULE_PX);
    expect(px('--euclid-row-gap')).toBe(EUCLID_ROW_GAP_PX);
    expect(px('--euclid-cell-w')).toBe(22);
    expect(px('--lane-h')).toBe(42);
  });

  it('fits three lanes under the held rows, and not four', () => {
    expect(rows(3)).toBeLessThanOrEqual(room);
    expect(rows(4)).toBeGreaterThan(room);
  });
});

describe('the Lanes rule’s count', () => {
  it('counts Accent and Pitch beside the sound lanes', () => {
    expect(EUCLID_LANES_MAX).toBe(2 + STEP_MOD_LANES_MAX);
  });
});

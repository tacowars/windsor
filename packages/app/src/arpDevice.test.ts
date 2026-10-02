/**
 * The Arp device's tables (windsor#370 decisions 2, 3 and 5): every knob
 * stands in one column in the mockup's order, and the held step rows leave
 * room for two lanes in the device's one height, so nothing scrolls until a
 * third lane is added.
 */
import { describe, expect, it } from 'vitest';

import { ARP_KNOB_COLUMNS } from './arpGridConstants';
import {
  ARP_HEAD_ROWS_PX,
  ARP_ROW_GAP_PX,
  GRID_HEAD_ROWS_PX,
  SEQUENCER_DEVICE_PX,
  STRIP_ROW_GAP_PX,
  stripHeadPx,
} from './sequencerDeviceTables';
import { ARP_GRID_KNOBS, ARP_KNOBS } from './sequencerKnobTables';

const px = (prop: string): number => {
  const value = SEQUENCER_DEVICE_PX[prop];
  if (value === undefined) throw new Error(`no ${prop}`);
  return value;
};

describe('the Arp device’s columns (windsor#370 decision 2)', () => {
  it('stands every Arp table knob in exactly one column, Octaves beside Octave and Rotate', () => {
    const placed = ['octaves', ...ARP_KNOB_COLUMNS.flat()];
    const tabled = [...ARP_KNOBS, ...ARP_GRID_KNOBS].map((entry) => entry.f);
    expect([...placed].sort()).toEqual([...tabled].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('puts Vel, Acc vel and Acc mod together, then Gate and Skip', () => {
    expect(ARP_KNOB_COLUMNS).toEqual([
      ['velocity', 'accentVelocity', 'accentMod'],
      ['gate', 'skipChance'],
    ]);
  });
});

describe('the Arp strip’s height (decisions 3 and 5)', () => {
  /** The strip's room: the device less its border, the section's padding and its label. */
  const room = px('--seq-h') - 2 - 4 - 6 - 14;
  const lanes = (n: number): number => n * (px('--lane-h') + STRIP_ROW_GAP_PX);

  it('holds the step number, ♪ — ·, Oct, A, S and the 14 px ratchet', () => {
    expect(ARP_HEAD_ROWS_PX).toHaveLength(6);
    expect(ARP_HEAD_ROWS_PX.at(-1)).toBe(GRID_HEAD_ROWS_PX.at(-1));
    expect(px('--arp-strip-head-h')).toBe(stripHeadPx(ARP_HEAD_ROWS_PX, ARP_ROW_GAP_PX));
    expect(px('--arp-cell-h')).toBe(ARP_HEAD_ROWS_PX[1]);
  });

  it('fits two lanes under the step rows, and not three', () => {
    const head = px('--arp-strip-head-h');
    expect(head + lanes(2)).toBeLessThanOrEqual(room);
    expect(head + lanes(3)).toBeGreaterThan(room);
  });
});

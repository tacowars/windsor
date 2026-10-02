/**
 * The Basslead device's tables (windsor#371 decisions 2, 3 and 5): every
 * knob stands in one column in the mockup's order, Length and Rotate read
 * the engine's defaults, and the strip's held rows are the Arp's, so two
 * lanes fit in the device's one height and a third scrolls.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_BASS_CONFIG, GRID_STEPS_MAX } from '@windsor/engine';
import { BASS_KNOB_COLUMNS } from './bassGridConstants';
import {
  ARP_HEAD_ROWS_PX,
  ARP_ROW_GAP_PX,
  SEQUENCER_DEVICE_PX,
  STRIP_ROW_GAP_PX,
  stripHeadPx,
} from './sequencerDeviceTables';
import {
  BASS_KNOBS,
  BASS_LENGTH_KNOB,
  BASS_ROOT_BIAS_KNOB,
  BASS_ROTATE_KNOB,
} from './sequencerKnobTables';

const px = (prop: string): number => {
  const value = SEQUENCER_DEVICE_PX[prop];
  if (value === undefined) throw new Error(`no ${prop}`);
  return value;
};

describe('the Basslead device’s columns (decision 2)', () => {
  it('stands every Basslead table knob in exactly one column', () => {
    const placed = BASS_KNOB_COLUMNS.flat();
    const tabled = [...BASS_KNOBS, BASS_ROOT_BIAS_KNOB].map((entry) => entry.f);
    expect([...placed].sort()).toEqual([...tabled].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('puts Vel, Acc vel and Acc mod together, then Gate, Density and Root bias', () => {
    expect(BASS_KNOB_COLUMNS).toEqual([
      ['velocity', 'accentVelocity', 'accentMod'],
      ['gate', 'density', 'rootBias'],
    ]);
  });

  it('reads Length’s default from the engine, over the Grid’s range, and Rotate stores no turn', () => {
    expect(BASS_LENGTH_KNOB.def).toBe(DEFAULT_BASS_CONFIG.length);
    expect(BASS_LENGTH_KNOB.min).toBe(1);
    expect(BASS_LENGTH_KNOB.max).toBe(GRID_STEPS_MAX);
    expect(BASS_ROTATE_KNOB.def).toBe(0);
  });
});

describe('the Basslead strip’s height (decisions 3 and 5)', () => {
  /** The strip's room: the device less its border, the section's padding and its label. */
  const room = px('--seq-h') - 2 - 4 - 6 - 14;
  const lanes = (n: number): number => n * (px('--lane-h') + STRIP_ROW_GAP_PX);

  it('holds the Arp’s rows: the step number, ♪ — ·, Oct, A, S and the ratchet', () => {
    expect(px('--arp-strip-head-h')).toBe(stripHeadPx(ARP_HEAD_ROWS_PX, ARP_ROW_GAP_PX));
  });

  it('fits two lanes under the step rows, and not three', () => {
    const head = px('--arp-strip-head-h');
    expect(head + lanes(2)).toBeLessThanOrEqual(room);
    expect(head + lanes(3)).toBeGreaterThan(room);
  });
});

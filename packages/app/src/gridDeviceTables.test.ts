/**
 * The Grid device's controls (windsor#368 decisions 3 and 5): every table
 * knob stands in one column, in the mockup's order.
 */
import { describe, expect, it } from 'vitest';

import { GRID_KNOB_COLUMNS } from './gridDeviceTables';
import { GRID_KNOBS } from './sequencerKnobTables';

describe('the Grid device’s columns (windsor#368)', () => {
  it('stands every Grid table knob in exactly one column', () => {
    const placed = GRID_KNOB_COLUMNS.flat();
    expect([...placed].sort()).toEqual(GRID_KNOBS.map((entry) => entry.f).sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('puts Vel, Acc vel and Acc mod together, then Skip alone', () => {
    expect(GRID_KNOB_COLUMNS).toEqual([
      ['velocity', 'accentVelocity', 'accentMod'],
      ['skipChance'],
    ]);
  });
});

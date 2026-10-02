/**
 * The Grid device's controls (windsor#368 decisions 3 and 5): every table
 * knob stands in one column, in the mockup's order, and the Octave knob is
 * the device's, so the pane adds one for the Chord only.
 */
import { describe, expect, it } from 'vitest';

import { GRID_KNOB_COLUMNS } from './gridDeviceTables';
import { GRID_KNOBS } from './sequencerKnobTables';
import { PANE_OCTAVE_KINDS } from './songViewTables';

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

  it('leaves the Grid’s Octave to the device and keeps the pane’s for the Chord', () => {
    expect(PANE_OCTAVE_KINDS).not.toContain('grid');
    expect(PANE_OCTAVE_KINDS).toContain('chord');
  });
});

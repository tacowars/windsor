/**
 * The Roll's Velocity row (windsor#754; record
 * `2026-10-12-roll-note-accent-and-ratchet` decision 9): Vel on the part,
 * and the Grid's Acc vel and Acc mod on the roll's two amounts, each
 * defaulting to what the engine plays a roll without them at.
 */
import {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  DEFAULT_ROLL_CONFIG,
  VELOCITY_DEFAULT,
} from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import { GRID_KNOBS, ROLL_ACCENT_KNOBS, ROLL_KNOBS } from './sequencerKnobTables';

describe('the Roll’s Velocity row', () => {
  it('is Vel, Acc vel and Acc mod, on the part and the roll', () => {
    const row = [...ROLL_KNOBS, ...ROLL_ACCENT_KNOBS];
    expect(row.map((k) => [k.kind, k.f, k.label])).toEqual([
      ['section', 'velocity', 'Vel'],
      ['driver', 'accentVelocity', 'Acc vel'],
      ['driver', 'accentMod', 'Acc mod'],
    ]);
    expect(ROLL_KNOBS[0]?.o.def).toBe(VELOCITY_DEFAULT);
  });

  it('defaults the accent amounts to what a roll without them plays at', () => {
    expect(DEFAULT_ROLL_CONFIG).not.toHaveProperty('accentVelocity');
    expect(DEFAULT_ROLL_CONFIG).not.toHaveProperty('accentMod');
    expect(ROLL_ACCENT_KNOBS.map((k) => k.o.def)).toEqual([
      ACCENT_VELOCITY_DEFAULT,
      ACCENT_MOD_DEFAULT,
    ]);
  });

  it('takes the Grid’s ranges and readouts for its two accent knobs', () => {
    for (const knob of ROLL_ACCENT_KNOBS) {
      const grid = GRID_KNOBS.find((k) => k.kind === 'driver' && k.f === knob.f);
      expect(grid?.label, knob.f).toBe(knob.label);
      expect([grid?.o.min, grid?.o.max, grid?.o.fmt], knob.f).toEqual([
        knob.o.min,
        knob.o.max,
        knob.o.fmt,
      ]);
    }
  });
});

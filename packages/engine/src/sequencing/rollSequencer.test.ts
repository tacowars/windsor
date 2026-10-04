/**
 * The Roll's defaults and check (windsor#599): an empty loop of one bar of
 * the song's meter, and the check refusing each field out of its range.
 */
import { describe, expect, it } from 'vitest';

import { ROLL_NOTES_MAX } from '../audioConstants';
import {
  DEFAULT_ROLL_CONFIG,
  ROLL_LOOP_TICKS_MAX,
  assertRollConfig,
  defaultRollConfig,
  type RollNote,
} from './rollSequencer';

const NOTE: RollNote = { tick: 0, ticks: 24, pitch: 60 };

describe('the Roll config (windsor#599)', () => {
  it("defaults to no notes over one bar of the song's meter", () => {
    expect(DEFAULT_ROLL_CONFIG).toEqual({ loopTicks: 96, notes: [] });
    expect(defaultRollConfig('7/8').loopTicks).toBe(84);
    expect(defaultRollConfig('12/8').loopTicks).toBe(144);
    expect(() => assertRollConfig(DEFAULT_ROLL_CONFIG)).not.toThrow();
  });

  it('accepts every field at its bounds, a note past the loop included', () => {
    const notes: RollNote[] = [
      { tick: ROLL_LOOP_TICKS_MAX - 1, ticks: ROLL_LOOP_TICKS_MAX, pitch: 127, velocity: 0 },
      { tick: 200, ticks: 1, pitch: 0, velocity: 1 },
    ];
    expect(() => assertRollConfig({ loopTicks: 96, notes })).not.toThrow();
    const full = Array.from({ length: ROLL_NOTES_MAX }, () => NOTE);
    expect(() => assertRollConfig({ loopTicks: ROLL_LOOP_TICKS_MAX, notes: full })).not.toThrow();
  });

  it('refuses each field out of its range', () => {
    const bad: [string, object][] = [
      ['loopTicks', { loopTicks: 0, notes: [] }],
      ['loopTicks', { loopTicks: ROLL_LOOP_TICKS_MAX + 1, notes: [] }],
      ['notes', { loopTicks: 96, notes: Array.from({ length: ROLL_NOTES_MAX + 1 }, () => NOTE) }],
      ['tick', { loopTicks: 96, notes: [{ ...NOTE, tick: 1.5 }] }],
      ['ticks', { loopTicks: 96, notes: [{ ...NOTE, ticks: 0 }] }],
      ['pitch', { loopTicks: 96, notes: [{ ...NOTE, pitch: 128 }] }],
      ['velocity', { loopTicks: 96, notes: [{ ...NOTE, velocity: 1.4 }] }],
    ];
    for (const [field, config] of bad) {
      expect(() => assertRollConfig(config as never), field).toThrow(field);
    }
  });
});

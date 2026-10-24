/**
 * The Drum device's tables (windsor#951; record `2026-10-24-drum-device`):
 * every table knob stands in one column in the mockup's order, Length
 * starts where the engine's new part does, and the held rows are the
 * approved 138 px under a square hit pad (decision 6).
 */
import { DEFAULT_DRUM_CONFIG } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import { DRUM_KNOB_COLUMNS } from './drumTables';
import { SEQUENCER_DEVICE_PX } from './sequencerDeviceTables';
import { DRUM_KNOBS, DRUM_LENGTH_KNOB, GRID_LENGTH_KNOB } from './sequencerKnobTables';

describe('the Drum device', () => {
  it('stands every Drum table knob in exactly one column: Vel, Acc vel, Acc mod; Gate, Vary, Chance', () => {
    expect(DRUM_KNOB_COLUMNS).toEqual([
      ['velocity', 'accentVelocity', 'accentMod'],
      ['gate', 'randomness', 'probability'],
    ]);
    const placed = DRUM_KNOB_COLUMNS.flat();
    expect([...placed].sort()).toEqual(DRUM_KNOBS.map((entry) => entry.f).sort());
  });

  it('takes the Grid’s Length range over the Drum’s own new part', () => {
    expect(DRUM_LENGTH_KNOB.def).toBe(DEFAULT_DRUM_CONFIG.length);
    expect([DRUM_LENGTH_KNOB.min, DRUM_LENGTH_KNOB.max]).toEqual([
      GRID_LENGTH_KNOB.min,
      GRID_LENGTH_KNOB.max,
    ]);
  });

  it('holds its rows in 138 px, a square pad as wide as the step column', () => {
    expect(SEQUENCER_DEVICE_PX['--drum-strip-head-h']).toBe(138);
    expect(SEQUENCER_DEVICE_PX['--step-w']).toBe(32);
  });
});

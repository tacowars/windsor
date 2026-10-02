/**
 * The Grid device's control columns (windsor#368 decision 5; the mockup's
 * order, `docs/research/2026-09-30-sequencer-rack/grid.html`): after Step
 * and Randomize, and Octave, Length and Rotate, the table knobs in columns
 * of three, named by the field each writes (`GRID_KNOBS`).
 */
import type { SequencerKnobEntry } from './sequencerKnobTables';

/** The table knobs' columns, top down: the dynamics, then Skip. */
export const GRID_KNOB_COLUMNS: readonly (readonly SequencerKnobEntry['f'][])[] = [
  ['velocity', 'accentVelocity', 'accentMod'],
  ['skipChance'],
];

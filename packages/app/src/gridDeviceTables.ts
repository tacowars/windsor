/**
 * The Grid device's control columns (windsor#368 decision 5; the mockup's
 * order, `docs/research/2026-09-30-sequencer-rack/grid.html`): after Step,
 * Seed, Randomize and Reverse, and Octave, Length and Rotate, the table
 * knobs in columns of three, named by the field each writes (`GRID_KNOBS`).
 */
import type { SequencerKnobEntry } from './sequencerKnobTables';

/**
 * The table knobs' columns, top down: the dynamics, then step variation's
 * Vary and Chance (windsor#936), whose column's third row holds the Rests
 * sound and Octave toggles (`gridControls.ts`).
 */
export const GRID_KNOB_COLUMNS: readonly (readonly SequencerKnobEntry['f'][])[] = [
  ['velocity', 'accentVelocity', 'accentMod'],
  ['randomness', 'probability'],
];

/**
 * The Drum device's tables (windsor#951; the approved mockup
 * `docs/design/drum-device-mockup.html`, record `2026-10-24-drum-device`):
 * what Randomize draws (decision 4), the Pitch cell's drag, where a ghost
 * hit's dot dims (decision 3), the order of the knob columns and the
 * device's words. The logic is `drumModel.ts` and `drumGridModel.ts`, which
 * take their table as a parameter defaulting to the one here; the rows' px
 * are `sequencerDeviceTables.ts`'s, beside the other devices'.
 */
import type { SequencerKnobEntry } from './sequencerKnobTables';

/** Randomize's new hits (decision 4): a velocity on a grid from a floor up to 1. */
export interface DrumRandomTable {
  /** The quietest velocity a new hit draws. */
  readonly velocityMin: number;
  /** The velocities a new hit draws are this far apart, from `velocityMin` to 1. */
  readonly velocityStep: number;
}

/** Each new hit at 0.3 to 1 in steps of 0.05, each as likely: ghosts to full hits. */
export const DRUM_RANDOM: DrumRandomTable = { velocityMin: 0.3, velocityStep: 0.05 };

/** The Pitch cell's drag (the mockup's): a semitone per this many px, and a click's slack. */
export interface DrumPitchDragTable {
  /** Pixels of vertical drag per semitone. */
  readonly semitonePx: number;
  /** Under this many pixels a press is a click, not a drag. */
  readonly thresholdPx: number;
}

export const DRUM_PITCH_DRAG: DrumPitchDragTable = { semitonePx: 8, thresholdPx: 3 };

/** Decision 3: a hit under this velocity is a ghost, its dot dimmed in the hit row. */
export const DRUM_GHOST_BELOW = 0.5;

/**
 * The knob strip after Length and Rotate (the mockup's order), in columns of
 * three, named by the field each writes: the dynamics, then Gate and step
 * variation's Vary and Chance, with the Per effect, Rests sound and Octave
 * toggles in a column of their own beside them, as the Arp draws it.
 */
export const DRUM_KNOB_COLUMNS: readonly (readonly SequencerKnobEntry['f'][])[] = [
  ['velocity', 'accentVelocity', 'accentMod'],
  ['gate', 'randomness', 'probability'],
];

/** The device's words, the mockup's. */
export const DRUM_TEXT = {
  pattern: 'Pattern',
  patternTitle: 'A pattern from the bank: it replaces the steps and the length',
  custom: 'Custom',
  note: 'Note',
  noteDown: 'Note down a semitone',
  noteUp: 'Note up a semitone',
  randomize: 'Randomize',
  randomizeTitle: 'New hits: as many as now, at new places, each at a velocity from 0.3 to 1',
  reverse: 'Reverse',
  reverseTitle: 'Mirror the steps: every cell and lane value, last to first',
  steps: 'Steps',
  hitTitle: 'hit: click for a rest',
  restTitle: 'rest: click for a hit',
  accent: 'accent',
  restRatchetTitle: 'A rest has no ratchet',
} as const;

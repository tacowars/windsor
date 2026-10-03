/**
 * The Figure device's tables (windsor#490, epic windsor#483; the look is
 * `docs/research/2026-10-03-figure-sequencer/figure.html`): what Randomize
 * draws, the Vel cell's step and drag, how a tone's interval is named, the
 * schedule's and drift's starting values, and the order of the knob
 * columns. The logic is `figureModel.ts` and `figureProcessModel.ts`, each
 * taking its table as a parameter defaulting to the one here.
 */
import type { SequencerKnobEntry } from './sequencerKnobTables';

export interface FigureRandomTable {
  /** Chance a cell becomes a rest. */
  readonly rest: number;
  /** Chance a cell becomes a tie (the same draw as the rest's, past it). */
  readonly tie: number;
  /** Chance a note is accented, and separately that it slides. */
  readonly flag: number;
  /** Chance a note is shifted by an octave. */
  readonly octave: number;
  /** Chance that shift goes down rather than up. */
  readonly octaveDown: number;
  /** How far that shift goes, in octaves. */
  readonly octaveSpan: number;
  /** Chance a note rolls: ×2 up to `RATCHET_MAX`, each as likely. */
  readonly ratchet: number;
  /** The velocities a note draws from, each as likely: a written dynamic, not noise. */
  readonly velocities: readonly number[];
}

/**
 * The Arp's Randomize odds (a rest or a tie about one cell in eight each,
 * accent and slide at 25%, an octave on one note in four, a roll on one in
 * eight), and a velocity from four written levels, so the reroll keeps the
 * shape of a figure.
 */
export const FIGURE_RANDOM: FigureRandomTable = {
  rest: 0.125,
  tie: 0.125,
  flag: 0.25,
  octave: 0.25,
  octaveDown: 0.5,
  octaveSpan: 1,
  ratchet: 0.125,
  velocities: [1, 0.9, 0.8, 0.6],
};

/** The Vel cell (windsor#489: a bar you drag, 0..1): its step, and the drag that sweeps the whole range. */
export const FIGURE_VEL = {
  /** A drag lands on multiples of this. */
  step: 0.05,
  /** Pixels of vertical drag from 0 to 1. */
  dragPx: 80,
  /** Under this many pixels a press is a click, not a drag. */
  thresholdPx: 3,
  /** The fill's width at 1, in percent of the cell. */
  fullPct: 100,
} as const;

/**
 * A tone's interval above the chord's root, in semitones within the octave,
 * named as a degree (windsor#489: chord degrees, `R 3 5 7`). Where two names
 * fit one interval, the one nearer the stack position's tertian degree wins
 * (`FIGURE_TERTIAN_DEGREES`), so a diminished fifth reads 5 and a sus
 * fourth 4.
 */
export const FIGURE_INTERVAL_DEGREES: readonly (readonly number[])[] = [
  [1],
  [2],
  [2],
  [3],
  [3],
  [4],
  [4, 5],
  [5],
  [5, 6],
  [6, 7],
  [7],
  [7],
];

/** The degree each stack position names in a chord built in thirds: R, 3, 5, 7. */
export const FIGURE_TERTIAN_DEGREES: readonly number[] = [1, 3, 5, 7];

/** The glyphs of a tone label: the root, an octave up, an octave down. */
export const FIGURE_TONE_GLYPHS = { root: 'R', up: "'", down: '−' } as const;

/** The stack the region summary names its first cells over: the song's chords are not the lane's. */
export const FIGURE_SUMMARY_STACK: readonly number[] = [0, 4, 7];

/** How many cells the region summary names. */
export const FIGURE_SUMMARY_CELLS = 4;

/** A new schedule's first stage: the Glass figure's opening four cells, for two bars. */
export const FIGURE_FIRST_STAGE = { length: 4, bars: 2 } as const;

/** A new drift's bar count, where the Every knob starts before any drift is written. */
export const FIGURE_DRIFT_EVERY_DEFAULT = 4;

/** Pixels of vertical drag per unit on a stage chip's length or bars. */
export const FIGURE_CHIP_DRAG_PX = 8;

/**
 * The Play page's table knobs after Octave, Length and Rotate (the
 * mockup's order), in columns of three, named by the field each writes.
 */
export const FIGURE_KNOB_COLUMNS: readonly (readonly SequencerKnobEntry['f'][])[] = [
  ['velocity', 'accentVelocity', 'accentMod'],
  ['gate', 'skipChance'],
];

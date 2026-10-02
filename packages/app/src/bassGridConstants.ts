/**
 * The Basslead device's tables (windsor#371, record
 * `2026-10-01-sequencer-rack-devices` decision 9): what Randomize draws for
 * each written step, and the order of the knob columns after Octave,
 * Length and Rotate. The logic is `bassGridModel.ts`'s `randomBassSteps`,
 * which takes the draw table as a parameter defaulting to this one, and
 * `bassCard.ts`, which lays the knobs out.
 */
import type { ArpRandomTable } from './arpGridConstants';
import type { SequencerKnobEntry } from './sequencerKnobTables';

/**
 * A bass line's reroll: a rest on about one step in seven, so the line
 * breathes, a tie on one in ten, accent and slide at the Grid's 25%, an
 * octave jump of ±1 on one note in five, and a roll on one note in ten.
 * The pitch is the pitch mode's, so nothing here draws one.
 */
export const BASS_RANDOM: ArpRandomTable = {
  rest: 0.15,
  tie: 0.1,
  flag: 0.25,
  octave: 0.2,
  octaveDown: 0.5,
  octaveSpan: 1,
  ratchet: 0.1,
};

/**
 * The table knobs after Octave, Length and Rotate, in columns of three, in
 * the mockup's order, named by the field each writes: the dynamics, then
 * Gate, Density and Root bias.
 */
export const BASS_KNOB_COLUMNS: readonly (readonly SequencerKnobEntry['f'][])[] = [
  ['velocity', 'accentVelocity', 'accentMod'],
  ['gate', 'density', 'rootBias'],
];

/** The Steps label's bar count: at most this many decimals, the trailing zeros dropped. */
export const BASS_BARS_DECIMALS = 3;

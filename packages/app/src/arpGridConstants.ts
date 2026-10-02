/**
 * The Arp device's tables (windsor#137, epic windsor#126 decision 8; the
 * device, windsor#370): what Randomize draws for each shown cell, and the
 * order of the knob columns. The logic is `arpGridModel.ts`'s
 * `randomArpCells`, which takes the draw table as a parameter defaulting to
 * it, and `arpCard.ts`, which lays the knobs out.
 */
import type { SequencerKnobEntry } from './sequencerKnobTables';

export interface ArpRandomTable {
  /** Chance a cell becomes a rest. */
  readonly rest: number;
  /** Chance a cell becomes a tie (the same draw as the rest's, past it). */
  readonly tie: number;
  /** Chance a note is accented, and separately that it slides: the grid's 25%. */
  readonly flag: number;
  /** Chance a note is shifted by an octave. */
  readonly octave: number;
  /** Chance that shift goes down rather than up. */
  readonly octaveDown: number;
  /** How far that shift goes, in octaves. */
  readonly octaveSpan: number;
  /** Chance a note rolls (windsor#370): ×2 up to `RATCHET_MAX`, each as likely. */
  readonly ratchet: number;
}

/**
 * A rest or a tie now and then (about one cell in eight each), accent and
 * slide at 25% as the grid's Randomize, an octave of ±1 on about one note
 * in four, and a roll on about one note in eight, so the line keeps the
 * arp's shape under the reroll.
 */
export const ARP_RANDOM: ArpRandomTable = {
  rest: 0.125,
  tie: 0.125,
  flag: 0.25,
  octave: 0.25,
  octaveDown: 0.5,
  octaveSpan: 1,
  ratchet: 0.125,
};

/**
 * The device's table knobs after Octave, Octaves and Rotate (windsor#370
 * decision 2; the mockup's order), in columns of three, named by the field
 * each writes: the dynamics, then Gate and Skip.
 */
export const ARP_KNOB_COLUMNS: readonly (readonly SequencerKnobEntry['f'][])[] = [
  ['velocity', 'accentVelocity', 'accentMod'],
  ['gate', 'skipChance'],
];

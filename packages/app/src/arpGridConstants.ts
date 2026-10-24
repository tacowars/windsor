/**
 * The Arp device's tables (windsor#137, epic windsor#126 decision 8; the
 * device, windsor#370): what Randomize draws for each shown cell, the Gate
 * bar's drag (windsor#934), and the order of the knob columns. The logic is
 * `arpGridModel.ts`'s `randomArpCells` and `dragArpGate`, which take their
 * table as a parameter defaulting to it, and `arpCard.ts`, which lays the
 * knobs out.
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
 * The Gate bar's drag (windsor#934 decision 1): the Figure's Vel bar's
 * (`FIGURE_VEL`).
 */
export interface ArpGateBarTable {
  /** A drag lands on multiples of this. */
  readonly step: number;
  /** Pixels of vertical drag from 0 to 1. */
  readonly dragPx: number;
  /** Under this many pixels a press is a click, not a drag. */
  readonly thresholdPx: number;
  /** The fill's width at a played gate of 1, in percent of the cell. */
  readonly fullPct: number;
  /** The places the bar's title reads the played gate to, trailing zeros dropped (0.4, 0.595). */
  readonly playedPlaces: number;
}

/**
 * The Gate bar as the approved mockup draws it
 * (`docs/design/arp-gate-bar-mockup.html`): an 80 px drag sweeps 0 to 1 in
 * steps of 0.05, floored at the engine's `GATE_MIN` where it lands.
 */
export const ARP_GATE_BAR: ArpGateBarTable = {
  step: 0.05,
  dragPx: 80,
  thresholdPx: 3,
  fullPct: 100,
  playedPlaces: 4,
};

/**
 * The device's table knobs after Octave, Octaves and Rotate (windsor#370
 * decision 2; the mockup's order), in columns of three, named by the field
 * each writes: the dynamics, then Gate and step variation's Vary and Chance
 * (windsor#936), with the Rests sound and Octave toggles in a column of
 * their own beside it (`arpCard.ts`).
 */
export const ARP_KNOB_COLUMNS: readonly (readonly SequencerKnobEntry['f'][])[] = [
  ['velocity', 'accentVelocity', 'accentMod'],
  ['gate', 'randomness', 'probability'],
];

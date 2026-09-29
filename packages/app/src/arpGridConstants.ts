/**
 * The Arp card's step-grid tunables (windsor#137, epic windsor#126 decision
 * 8): what Randomize draws for each shown cell. The logic is
 * `arpGridModel.ts`'s `randomArpCells`, which takes this table as a
 * parameter defaulting to it.
 */

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
}

/**
 * A rest or a tie now and then (about one cell in eight each), accent and
 * slide at 25% as the grid's Randomize, and an octave of ±1 on about one
 * note in four, so the line keeps the arp's shape under the reroll.
 */
export const ARP_RANDOM: ArpRandomTable = {
  rest: 0.125,
  tie: 0.125,
  flag: 0.25,
  octave: 0.25,
  octaveDown: 0.5,
  octaveSpan: 1,
};

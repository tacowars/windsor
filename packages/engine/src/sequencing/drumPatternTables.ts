/**
 * The Drum's pattern bank (windsor#950, record `2026-10-24-drum-sequencer`):
 * the row notation its tables are written in, and the bar every pattern
 * fills. Each group's patterns are `drumPatternTables<Group>.ts`;
 * `drumPatterns.ts` expands the rows into steps.
 *
 * A pattern is one bar of `DRUM_PATTERN_STEPS` sixteenths, one character
 * per step in each row:
 *
 * - `velocity`: `.` a rest, `1`–`9` a hit at 0.1–0.9, `X` a hit at 1.0.
 * - `half` (optional): `+` where the hit plays 0.05 above its digit, so
 *   `4` with `+` is 0.45; never on an `X`.
 * - `accent` (optional): `!` where the hit is accented.
 * - `ratchet` (optional): `2`–`4` where the hit rolls that many hits.
 * - `pitch` (optional): sixteen whole-semitone offsets, 0 at a rest.
 *
 * Every other character is `.`, and a mark on a rest is refused.
 */

/** The steps every pattern holds: one bar of sixteenths in 4/4. */
export const DRUM_PATTERN_STEPS = 16;

/** The characters the rows are written in, and the velocity a digit stands for. */
export const DRUM_PATTERN_NOTATION = {
  /** A rest in the velocity row; no mark in the others. */
  blank: '.',
  /** A hit at velocity 1. */
  full: 'X',
  /** A digit `d` is velocity `d / tenths`. */
  tenths: 10,
  /** A half mark raises its hit by half a tenth. */
  half: '+',
  accent: '!',
} as const;

export type DrumPatternNotation = typeof DRUM_PATTERN_NOTATION;

/** One pattern as its table writes it. */
export interface DrumPatternRows {
  /** Unique, kebab-case: what the picker and the tests name. */
  readonly id: string;
  /** The picker's label, US English. */
  readonly name: string;
  readonly velocity: string;
  readonly half?: string;
  readonly accent?: string;
  readonly ratchet?: string;
  readonly pitch?: readonly number[];
}

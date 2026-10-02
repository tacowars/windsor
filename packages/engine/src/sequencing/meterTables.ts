/**
 * The meters a song may play in (windsor#428), as data: each one's counted
 * beats in ticks on the 24 PPQ grid. A bar is the sum of its beats, and
 * swing's pairs restart at every beat (`swing.ts`).
 *
 * One meter per song, from this fixed list; no meter changes inside a song.
 * A quarter-note beat is 24 ticks and a dotted-quarter beat (three 8ths) is
 * 36. 7/8 is grouped 2+2+3, the more common grouping. `meter.test.ts` pins
 * the quarter to `PPQ` and every bar to its time signature.
 */

/** The meters a song may name, by their time signature. */
export const METERS = ['3/4', '4/4', '5/4', '6/8', '7/8', '12/8'] as const;
export type Meter = (typeof METERS)[number];

/** What a song plays when it names no meter: today's only one. */
export const FOUR_FOUR: Meter = '4/4';

/** A meter's counted beats, in ticks, in the order they fall in the bar. */
export type MeterBeats = readonly number[];

/** One quarter-note beat, and one dotted-quarter beat (three 8ths), in ticks. */
const QUARTER = 24;
const DOTTED_QUARTER = 36;

/** What the meter arithmetic reads: every meter's beats. */
export type MeterTable = Readonly<Record<Meter, MeterBeats>>;

/** The shipped table: every meter's beats, in ticks. */
export const METER_TABLE: MeterTable = {
  '3/4': [QUARTER, QUARTER, QUARTER],
  '4/4': [QUARTER, QUARTER, QUARTER, QUARTER],
  '5/4': [QUARTER, QUARTER, QUARTER, QUARTER, QUARTER],
  '6/8': [DOTTED_QUARTER, DOTTED_QUARTER],
  '7/8': [QUARTER, QUARTER, DOTTED_QUARTER],
  '12/8': [DOTTED_QUARTER, DOTTED_QUARTER, DOTTED_QUARTER, DOTTED_QUARTER],
};

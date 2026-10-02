/**
 * A meter's arithmetic (windsor#428): its beats, its bar and a song's length
 * in ticks. Every song plays 4/4 until the song document names a meter, and
 * in 4/4 every result here is what the fixed 4/4 constants gave
 * (`TICKS_PER_BAR`, `bars * TICKS_PER_BAR`). Pure; the table is a parameter
 * defaulting to the shipped one (`meterTables.ts`).
 */
import { GRID_STEPS_MAX } from '../audioConstants';
import {
  FOUR_FOUR,
  METER_TABLE,
  type Meter,
  type MeterBeats,
  type MeterTable,
} from './meterTables';

/** True for a meter the table names. */
export function isMeter(value: unknown, table: MeterTable = METER_TABLE): value is Meter {
  return typeof value === 'string' && Object.hasOwn(table, value);
}

/**
 * A meter's counted beats, in ticks. A meter the table does not name (a live
 * partial that never went through the normaliser) reads as 4/4.
 */
export function meterBeats(meter: Meter = FOUR_FOUR, table: MeterTable = METER_TABLE): MeterBeats {
  return isMeter(meter, table) ? table[meter] : table[FOUR_FOUR];
}

/**
 * The sum of `beats`: one bar, in ticks. An index loop, since the swing warp
 * calls it per tick and allocates nothing.
 */
export function barTicks(beats: MeterBeats): number {
  let ticks = 0;
  for (let i = 0; i < beats.length; i++) ticks += beats[i]!;
  return ticks;
}

/** One bar of `meter`, in ticks. */
export function ticksPerBar(meter: Meter = FOUR_FOUR, table: MeterTable = METER_TABLE): number {
  return barTicks(meterBeats(meter, table));
}

/** A song of `bars` bars of `meter`, in ticks: the one place a song's length is computed. */
export function songTicks(
  bars: number,
  meter: Meter = FOUR_FOUR,
  table: MeterTable = METER_TABLE,
): number {
  return bars * ticksPerBar(meter, table);
}

/**
 * The steps in one bar of `meter` at `divisor`, 1 to `max` (windsor#429,
 * decision 5): what a new Grid, Bass or Euclid part starts with. A step
 * that does not tile the bar rounds down (7/8 at 1/4 is 3 steps). 4/4 at
 * 1/16 is 16, 7/8 at 1/16 is 14, 6/8 at 1/8 is 6, 12/8 at 1/16 is 24.
 * An absent meter is 4/4, as a song without one plays.
 */
export function defaultStepCount(
  meter: Meter | undefined,
  divisor: number,
  max: number = GRID_STEPS_MAX,
  table: MeterTable = METER_TABLE,
): number {
  return Math.max(1, Math.min(max, Math.floor(ticksPerBar(meter, table) / divisor)));
}

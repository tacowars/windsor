/**
 * The swing time warp (windsor#14): a piecewise-linear map from a tick
 * position to where it sounds, in straight ticks, within each pair of the
 * swing grid.
 *
 * A pair of `P` ticks splits at its midpoint. The first half stretches to
 * `amount`% of the pair and the second compresses into the rest, so the
 * off-beat (the midpoint) lands at `amount`% and the pair's boundaries do not
 * move. The map is monotonic at every amount the song allows, so a note off
 * the grid (an arp, a Euclidean onset, a chord event) moves proportionally
 * and never passes its neighbour.
 *
 * Pairs restart at every counted beat of the meter (windsor#428): bars of the
 * meter's beats tile the song from tick 0, and pairs run from each beat's
 * start. A remainder shorter than a pair plays straight, so in 6/8 on the 8ths
 * grid each dotted-quarter beat is one swung pair and one straight 8th. In 4/4
 * every beat is 24 ticks, which both grids' pairs divide, so the warp is the
 * pre-meter one bit for bit.
 *
 * The phase is the transport tick's, never the audio time's: a tempo change
 * cannot move a pair boundary off the grid, and the song-end wrap is a whole
 * number of bars, so it lands on a beat. Pure and allocation-free; the
 * scheduler calls `swingSlope` once per tick.
 */
import { barTicks } from './meter';
import { FOUR_FOUR, METER_TABLE, type MeterBeats } from './meterTables';
import { STRAIGHT_SWING, SWING_TABLE, type Swing, type SwingTable } from './swingTables';

/** The beats a warp reads when it is handed none: 4/4's. */
const FOUR_FOUR_BEATS = METER_TABLE[FOUR_FOUR];

/**
 * A swing the clock can play: the amount clamped into the table's range, a
 * grid it has no pair for made straight 16ths. The document normaliser
 * reports the same repairs; this is the clock's own guard, for a live partial
 * that never went through it.
 */
export function playableSwing(swing: Swing | undefined, table: SwingTable = SWING_TABLE): Swing {
  if (!swing) return STRAIGHT_SWING;
  const amount = Number.isFinite(swing.amount)
    ? Math.min(table.max, Math.max(table.straight, swing.amount))
    : table.straight;
  const grid = Object.hasOwn(table.pairTicks, swing.grid) ? swing.grid : STRAIGHT_SWING.grid;
  return amount === swing.amount && grid === swing.grid ? swing : { amount, grid };
}

/** True when the warp is the identity — the pre-windsor#14 clock, bit for bit. */
export function isStraight(swing: Swing, table: SwingTable = SWING_TABLE): boolean {
  return swing.amount === table.straight;
}

/** The off-beat's position in its pair as a fraction (0.5 straight). */
function offBeat(swing: Swing, table: SwingTable): number {
  return swing.amount / table.percent;
}

/**
 * The start of the swung pair holding `position` (a tick, or a warped tick:
 * the warp leaves every pair and beat boundary where it is). Bars of `beats`
 * tile the song from tick 0 and pairs of `pair` ticks run from each beat's
 * start. NaN when `position` falls in a beat's remainder shorter than a pair,
 * which plays straight.
 */
function swungPairStart(position: number, pair: number, beats: MeterBeats): number {
  const bar = barTicks(beats);
  let beatStart = Math.floor(position / bar) * bar;
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i]!;
    if (position < beatStart + beat) {
      const into = Math.floor((position - beatStart) / pair) * pair;
      return into + pair <= beat ? beatStart + into : NaN;
    }
    beatStart += beat;
  }
  return NaN;
}

/**
 * How long the tick interval `[tick, tick + 1]` lasts, in straight ticks:
 * `2a` in a pair's first half and `2(1 - a)` in its second, 1 in a beat's
 * straight remainder. Every pair sums to its own length. Exactly 1 when
 * straight.
 */
export function swingSlope(
  tick: number,
  swing: Swing,
  table: SwingTable = SWING_TABLE,
  beats: MeterBeats = FOUR_FOUR_BEATS,
): number {
  if (isStraight(swing, table)) return 1;
  const pair = table.pairTicks[swing.grid];
  const start = swungPairStart(tick, pair, beats);
  if (Number.isNaN(start)) return 1;
  const a = offBeat(swing, table);
  return tick - start < pair / 2 ? 2 * a : 2 * (1 - a);
}

/** Where tick position `tick` (fractional allowed) sounds, in straight ticks from 0. */
export function swingTicks(
  tick: number,
  swing: Swing,
  table: SwingTable = SWING_TABLE,
  beats: MeterBeats = FOUR_FOUR_BEATS,
): number {
  if (isStraight(swing, table)) return tick;
  const pair = table.pairTicks[swing.grid];
  const start = swungPairStart(tick, pair, beats);
  if (Number.isNaN(start)) return tick;
  const phase = tick - start;
  const half = pair / 2;
  const a = offBeat(swing, table);
  const warped = phase < half ? phase * 2 * a : a * pair + (phase - half) * 2 * (1 - a);
  return start + warped;
}

/** The inverse of `swingTicks`: the tick position that sounds at `warped` straight ticks. */
export function unswingTicks(
  warped: number,
  swing: Swing,
  table: SwingTable = SWING_TABLE,
  beats: MeterBeats = FOUR_FOUR_BEATS,
): number {
  if (isStraight(swing, table)) return warped;
  const pair = table.pairTicks[swing.grid];
  const start = swungPairStart(warped, pair, beats);
  if (Number.isNaN(start)) return warped;
  const phase = warped - start;
  const half = pair / 2;
  const a = offBeat(swing, table);
  const offBeatAt = a * pair;
  const tick = phase < offBeatAt ? phase / (2 * a) : half + (phase - offBeatAt) / (2 * (1 - a));
  return start + tick;
}

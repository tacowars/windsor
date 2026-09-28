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
 * The phase is the transport tick's, never the audio time's: a tempo change
 * or the song-end wrap (a whole number of bars, which every pair divides)
 * cannot move a pair boundary off the grid. Pure and allocation-free; the
 * scheduler calls `swingSlope` once per tick.
 */
import { STRAIGHT_SWING, SWING_TABLE, type Swing, type SwingTable } from './swingTables';

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
 * How long the tick interval `[tick, tick + 1]` lasts, in straight ticks:
 * `2a` in a pair's first half and `2(1 - a)` in its second. Every pair sums to
 * its own length. Exactly 1 when straight.
 */
export function swingSlope(tick: number, swing: Swing, table: SwingTable = SWING_TABLE): number {
  if (isStraight(swing, table)) return 1;
  const pair = table.pairTicks[swing.grid];
  const phase = ((tick % pair) + pair) % pair;
  const a = offBeat(swing, table);
  return phase < pair / 2 ? 2 * a : 2 * (1 - a);
}

/** Where tick position `tick` (fractional allowed) sounds, in straight ticks from 0. */
export function swingTicks(tick: number, swing: Swing, table: SwingTable = SWING_TABLE): number {
  if (isStraight(swing, table)) return tick;
  const pair = table.pairTicks[swing.grid];
  const start = Math.floor(tick / pair) * pair;
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
): number {
  if (isStraight(swing, table)) return warped;
  const pair = table.pairTicks[swing.grid];
  const start = Math.floor(warped / pair) * pair;
  const phase = warped - start;
  const half = pair / 2;
  const a = offBeat(swing, table);
  const offBeatAt = a * pair;
  const tick = phase < offBeatAt ? phase / (2 * a) : half + (phase - offBeatAt) / (2 * (1 - a));
  return start + tick;
}

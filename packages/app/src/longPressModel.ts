/**
 * The touch or pen long press's rules (windsor#825; record
 * `2026-10-16-song-tab-context-menu`, decision 8), pure so they are tested
 * in Node: which presses may become one, when moving cancels it, when it is
 * due, and when the hold ring is drawn. `longPress.ts` times it and
 * draws the ring; the part color picker and the context menus share it.
 */
import type { HoldRingTable, LongPressTable } from './contextMenuTables';
import { HOLD_RING, LONG_PRESS } from './contextMenuTables';

/** A point in the window, in CSS px. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A touch or a pen opens by a long press; a mouse opens by a right-click. */
export const longPressOpens = (pointerType: string): boolean =>
  pointerType === 'touch' || pointerType === 'pen';

/** The press has moved from `from` to `to` by more than the long press allows: it no longer opens. */
export const longPressMoved = (
  from: Point,
  to: Point,
  table: LongPressTable = LONG_PRESS,
): boolean => Math.hypot(to.x - from.x, to.y - from.y) > table.slopPx;

/**
 * Where a press held since `startMs` stands at `nowMs`, moved to `at`: it
 * opens once held for the table's time without moving past its distance.
 */
export function longPressDue(
  press: { readonly startMs: number; readonly from: Point },
  now: { readonly ms: number; readonly at: Point },
  table: LongPressTable = LONG_PRESS,
): boolean {
  return now.ms - press.startMs >= table.ms && !longPressMoved(press.from, now.at, table);
}

/**
 * When the hold ring is drawn and how long it fills: it waits for the ring's
 * show time, so a tap never flashes it, then fills evenly until the long
 * press opens.
 */
export const holdRingTiming = (
  ring: HoldRingTable = HOLD_RING,
  press: LongPressTable = LONG_PRESS,
): { readonly delayMs: number; readonly fillMs: number } => ({
  delayMs: ring.showMs,
  fillMs: press.ms - ring.showMs,
});

/**
 * The part colour picker's rules (windsor#642; record
 * `2026-10-07-part-colours`, decision 9), pure so they are tested in Node:
 * which presses may open it with a long press, when moving cancels that
 * press, where the picker sits so it stays on screen, and which colour's
 * name it shows. `partColourPicker.ts` draws it and wires the chip.
 */
import { partColor } from './consoleColors';
import type { LongPressTable, PickerPlaceTable } from './partColourPickerTables';
import { LONG_PRESS, PICKER_PLACE } from './partColourPickerTables';

/** A point in the window, in CSS px. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A box in the window, in CSS px, as `getBoundingClientRect` gives it. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** A touch or a pen opens the picker by a long press; a mouse opens it by a right-click. */
export const longPressOpens = (pointerType: string): boolean =>
  pointerType === 'touch' || pointerType === 'pen';

/** The press has moved from `from` to `to` by more than the long press allows: it no longer opens the picker. */
export const longPressMoved = (
  from: Point,
  to: Point,
  table: LongPressTable = LONG_PRESS,
): boolean => Math.hypot(to.x - from.x, to.y - from.y) > table.slopPx;

/**
 * Where a press held since `startMs` stands at `nowMs`, moved to `at`: it
 * opens the picker once held for the table's time without moving past its
 * distance.
 */
export function longPressDue(
  press: { readonly startMs: number; readonly from: Point },
  now: { readonly ms: number; readonly at: Point },
  table: LongPressTable = LONG_PRESS,
): boolean {
  return now.ms - press.startMs >= table.ms && !longPressMoved(press.from, now.at, table);
}

/**
 * The picker's top-left corner: under `anchor`, its left edge on the
 * anchor's, moved left as far as it must to keep the window's margin on the
 * right (and never past the margin on the left); above the anchor when the
 * window has no room below.
 */
export function pickerPosition(
  anchor: Box,
  size: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  table: PickerPlaceTable = PICKER_PLACE,
): Point {
  const right = viewport.width - size.width - table.marginPx;
  const x = Math.max(table.marginPx, Math.min(anchor.left, right));
  const below = anchor.bottom + table.gapPx;
  const fits = below + size.height <= viewport.height - table.marginPx;
  const y = fits ? below : Math.max(table.marginPx, anchor.top - table.gapPx - size.height);
  return { x, y };
}

/** The name under the grid: the swatch under the pointer, or else the part's own colour. */
export const swatchCaption = (hovered: number | null, current: number): string =>
  partColor(hovered ?? current).name;

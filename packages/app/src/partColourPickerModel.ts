/**
 * The part colour picker's rules (windsor#642; record
 * `2026-10-07-part-colours`, decision 9), pure so they are tested in Node:
 * where the picker sits so it stays on screen, and which colour's name it
 * shows. The long press that opens it is the shared one
 * (`longPressModel.ts`, windsor#825). `partColourPicker.ts` draws it and
 * wires the chip.
 */
import { partColor } from './consoleColors';
import type { Point } from './longPressModel';
import type { PickerPlaceTable } from './partColourPickerTables';
import { PICKER_PLACE } from './partColourPickerTables';

/** A box in the window, in CSS px, as `getBoundingClientRect` gives it. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
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

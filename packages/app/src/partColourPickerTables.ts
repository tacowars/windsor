/**
 * The part colour picker's tunables (windsor#642; record
 * `2026-10-07-part-colours`, decision 9). `partColourPickerModel.ts` reads
 * them; the swatches' size and gaps are `console.css`'s, and the long press
 * that opens it is the shared `LONG_PRESS` (`contextMenuTables.ts`).
 */

/** Where the picker sits against its chip and the window's edges. */
export interface PickerPlaceTable {
  /** The gap between the chip's bottom edge (or top, when placed above) and the picker, in CSS px. */
  readonly gapPx: number;
  /** The least room kept between the picker and the window's edges, in CSS px. */
  readonly marginPx: number;
}

export const PICKER_PLACE: PickerPlaceTable = { gapPx: 4, marginPx: 8 };

/**
 * The part colour picker's tunables (windsor#642; record
 * `2026-10-07-part-colours`, decision 9). `partColourPickerModel.ts` reads
 * them; the swatches' size and gaps are `console.css`'s.
 */

/** The touch or pen long press that opens the picker on a chip. */
export interface LongPressTable {
  /** How long the press is held before the picker opens. */
  readonly ms: number;
  /** How far the press may move, in CSS px, before it is a scroll and not a long press. */
  readonly slopPx: number;
}

export const LONG_PRESS: LongPressTable = { ms: 450, slopPx: 8 };

/** Where the picker sits against its chip and the window's edges. */
export interface PickerPlaceTable {
  /** The gap between the chip's bottom edge (or top, when placed above) and the picker, in CSS px. */
  readonly gapPx: number;
  /** The least room kept between the picker and the window's edges, in CSS px. */
  readonly marginPx: number;
}

export const PICKER_PLACE: PickerPlaceTable = { gapPx: 4, marginPx: 8 };

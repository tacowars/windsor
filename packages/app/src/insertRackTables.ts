/**
 * The insert rack's sizes (windsor#173, record
 * `2026-09-30-insert-rack-and-send-bus-chains` decisions 1 and 2): every
 * insert is one height and only its width varies. `stripInserts.ts` sets
 * each entry on the rack as a CSS custom property, and `console.css` reads
 * the properties, so the 196 px is written once, here.
 */

/** Custom property → px. The rack, every insert, the rail, the fold, the tabs and a wide column. */
export const INSERT_RACK_PX: Readonly<Record<string, number>> = {
  /** Every insert's height, and the Add slot's. */
  '--rack-h': 196,
  /** The side rail on each insert's left: switch, name, ◀ ▶ ✕. */
  '--rack-rail': 24,
  /** A folded insert: its rail and its border. */
  '--rack-fold': 26,
  /** The row of page tabs at the top of a body with two or more pages. */
  '--rack-tabs-h': 20,
  /** A column holding a picker, a switch or a note. */
  '--rack-wide-col': 104,
  /** The Add slot's width. */
  '--rack-add-w': 88,
  /** The Add picker's width, open in a slot's place. */
  '--rack-picker-w': 230,
};

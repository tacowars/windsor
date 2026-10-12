/**
 * The Song tab's fold arrow (windsor#768 decision 1; the approved mockup
 * `docs/design/song-mixer-mockup.html`, arrows option C): a filled triangle
 * drawn to the edges of a 16-unit box, pointing right while closed. The
 * stylesheet turns it 90° to point down while its button is open.
 */

/** The triangle's box, in SVG units. */
export const DISCLOSURE_VIEWBOX = 16;

/** The triangle, pointing right: the mockup's `TRI`. */
export const DISCLOSURE_TRIANGLE_PATH = 'M4 2.5 L13.5 8 L4 13.5 Z';

/** The triangle's drawn size, in px, by where it sits. */
export const DISCLOSURE_ARROW_PX = {
  /** A part's or a group's fold, filling the row's fold cell. */
  fold: 20,
  /** The mixer column's header, in its 22 px row. */
  header: 18,
} as const;

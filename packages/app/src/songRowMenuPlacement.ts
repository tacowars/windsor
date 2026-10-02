/**
 * Where a song row's ⋯ menu goes (windsor#434), without the DOM: under its
 * button with the right edges lined up, or above the button when the menu
 * would run past the viewport's bottom, and always clamped inside the
 * viewport on both axes. The menu is fixed-position and a page scroll closes
 * it, so an item placed off-screen could never be reached. A viewport too
 * small for the whole menu caps it to the room between the edge gaps, and
 * the menu scrolls inside itself (windsor#458).
 */
import { SONG_MENU_EDGE_PX, SONG_MENU_GAP_PX } from './songListTables';

/** The ⋯ button's box in viewport coordinates, as `getBoundingClientRect` gives it. */
export interface OpenerBox {
  readonly top: number;
  readonly bottom: number;
  readonly right: number;
}

export interface BoxSize {
  readonly width: number;
  readonly height: number;
}

export interface MenuPlacementRequest {
  readonly opener: OpenerBox;
  readonly menu: BoxSize;
  readonly viewport: BoxSize;
}

export interface MenuPlacement {
  readonly top: number;
  readonly left: number;
  /** The most the menu may be on each axis, the viewport less both edge gaps; past it, it scrolls. */
  readonly maxHeight: number;
  readonly maxWidth: number;
}

/** `value` held in [low, high]; a range too small for the box pins it to `low`. */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/** The room between the two edge gaps of a viewport `length` long. */
const room = (length: number, edge: number): number => Math.max(0, length - edge - edge);

/** The menu's top-left corner in viewport coordinates, and the size it is capped to. */
export function rowMenuPlacement(
  { opener, menu, viewport }: MenuPlacementRequest,
  gap = SONG_MENU_GAP_PX,
  edge = SONG_MENU_EDGE_PX,
): MenuPlacement {
  const maxHeight = room(viewport.height, edge);
  const maxWidth = room(viewport.width, edge);
  const height = Math.min(menu.height, maxHeight);
  const width = Math.min(menu.width, maxWidth);
  const below = opener.bottom + gap;
  const above = opener.top - gap - height;
  const fitsBelow = below + height <= viewport.height - edge;
  const top = fitsBelow || above < edge ? below : above;
  return {
    top: clamp(top, edge, viewport.height - edge - height),
    left: clamp(opener.right - width, edge, viewport.width - edge - width),
    maxHeight,
    maxWidth,
  };
}

/**
 * Where a song row's ⋯ menu goes (windsor#434), without the DOM: under its
 * button with the right edges lined up, or above the button when the menu
 * would run past the viewport's bottom, and always clamped inside the
 * viewport on both axes. The menu is fixed-position and a scroll closes it,
 * so an item placed off-screen could never be reached.
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
}

/** `value` held in [low, high]; a range too small for the box pins it to `low`. */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/** The menu's top-left corner in viewport coordinates. */
export function rowMenuPlacement(
  { opener, menu, viewport }: MenuPlacementRequest,
  gap = SONG_MENU_GAP_PX,
  edge = SONG_MENU_EDGE_PX,
): MenuPlacement {
  const below = opener.bottom + gap;
  const above = opener.top - gap - menu.height;
  const fitsBelow = below + menu.height <= viewport.height - edge;
  const top = fitsBelow || above < edge ? below : above;
  return {
    top: clamp(top, edge, viewport.height - edge - menu.height),
    left: clamp(opener.right - menu.width, edge, viewport.width - edge - menu.width),
  };
}

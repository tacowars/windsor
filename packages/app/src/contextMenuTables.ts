/**
 * The context menu's and the long press's tunables (windsor#825; record
 * `2026-10-16-song-tab-context-menu`, decisions 5, 6 and 8, and the approved
 * mockups `docs/design/song-region-menu-mockup.html` and
 * `docs/design/song-region-menu-tablet-mockup.html`). `contextMenuModel.ts`
 * and `longPressModel.ts` read them; `contextMenu.ts` hands the sizes to
 * `console.css` as custom properties.
 */

/** The touch or pen long press that opens a menu (and the part color picker). */
export interface LongPressTable {
  /** How long the press is held before it opens. */
  readonly ms: number;
  /** How far the press may move, in CSS px, before it is a scroll or a drag and not a long press. */
  readonly slopPx: number;
}

export const LONG_PRESS: LongPressTable = { ms: 450, slopPx: 8 };

/** The ring around the finger that fills over a long press's hold. */
export interface HoldRingTable {
  /** How long the press is held before the ring is drawn, so a tap never flashes it. */
  readonly showMs: number;
  /** The ring's radius, in CSS px, centered on the press. */
  readonly radiusPx: number;
}

export const HOLD_RING: HoldRingTable = { showMs: 150, radiusPx: 30 };

/** A menu's size, chosen by the `pointerType` of the press that opened it (decision 5). */
export interface MenuSizeTable {
  /** A row's height, in CSS px. */
  readonly rowPx: number;
  /** A row label's font size, in CSS px. */
  readonly labelPx: number;
  /** The least width of the menu, in CSS px. */
  readonly minWidthPx: number;
  /** Whether a row's keyboard hint (⌘X, ⌥-click) is shown; a reason or amount tag always is. */
  readonly keyboardTags: boolean;
}

/** A mouse (a trackpad's right-click included) and a touch or pen. */
export const MENU_SIZES: { readonly mouse: MenuSizeTable; readonly touch: MenuSizeTable } = {
  mouse: { rowPx: 32, labelPx: 12, minWidthPx: 220, keyboardTags: true },
  touch: { rowPx: 44, labelPx: 15, minWidthPx: 260, keyboardTags: false },
};

/** Where a mouse-opened menu and its submenus sit. */
export interface MousePlaceTable {
  /** The gap between the pointer and the menu's corner, in CSS px. */
  readonly gapPx: number;
  /** The least room kept between the menu and the window's edges, in CSS px. */
  readonly edgePx: number;
  /** How far a submenu overlaps its parent menu, in CSS px. */
  readonly submenuOverlapPx: number;
  /** How far above its row a submenu's top sits, so its first row lines up with the row: the menu's top padding and border. */
  readonly submenuRisePx: number;
}

export const MOUSE_PLACE: MousePlaceTable = {
  gapPx: 2,
  edgePx: 8,
  submenuOverlapPx: 4,
  submenuRisePx: 5,
};

/** Where a touch-opened menu sits: below-left of the finger (decision 6). */
export interface TouchPlaceTable {
  /** The gap between the touch point and the menu's near edge, in CSS px: the fingertip's radius plus a gap. */
  readonly besideFingerPx: number;
  /** The gap between the pressed lane's bottom and the menu's top, in CSS px. */
  readonly belowLanePx: number;
  /** The least room kept between the menu and the window's edges, in CSS px. */
  readonly edgePx: number;
}

export const TOUCH_PLACE: TouchPlaceTable = { besideFingerPx: 32, belowLanePx: 4, edgePx: 8 };

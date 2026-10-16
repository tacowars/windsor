/**
 * The context menu's rules (windsor#825; record
 * `2026-10-16-song-tab-context-menu`, decisions 5–7 and 10; the approved
 * mockups `docs/design/song-region-menu-mockup.html` and
 * `docs/design/song-region-menu-tablet-mockup.html`), pure so they are
 * tested in Node: the spec a caller hands the menu, the size the opening
 * press picks, where the menu and a submenu sit, the drilled-in rows of a
 * touch submenu, the row under a sliding finger, and what a press on a row
 * does, and the one open menu, whose close ends it exactly once.
 * `contextMenu.ts` draws it.
 */
import type { MenuSizeTable, MousePlaceTable, TouchPlaceTable } from './contextMenuTables';
import { MENU_SIZES, MOUSE_PLACE, TOUCH_PLACE } from './contextMenuTables';
import type { Point } from './longPressModel';
import { longPressOpens } from './longPressModel';
import type { BoxSize, MenuPlacement } from './songRowMenuPlacement';
import { rowMenuPlacement } from './songRowMenuPlacement';

/** A row the caller runs: its label, its tag and what it does. */
export interface MenuRow {
  readonly kind: 'row';
  readonly label: string;
  /** Dim text at the row's right: a keyboard hint, a reason or an amount. */
  readonly tag?: string;
  /** The tag is a keyboard hint (⌘X, ⌥-click), which a touch-opened menu leaves out. */
  readonly kbd?: boolean;
  /** Drawn dim; it never previews or runs. */
  readonly disabled?: boolean;
  run(): void;
  /** Show what the row would do, while it is hovered or under the finger. */
  preview?(): void;
  /** Take that preview away again. */
  unpreview?(): void;
}

/** A row that opens more rows: beside it for a mouse, in its place for touch. */
export interface MenuSubmenu {
  readonly kind: 'submenu';
  readonly label: string;
  readonly items: readonly MenuItem[];
}

export interface MenuSeparator {
  readonly kind: 'separator';
}

export type MenuItem = MenuRow | MenuSubmenu | MenuSeparator;

export const SEPARATOR: MenuSeparator = { kind: 'separator' };

/** What the menu shows: an optional head line and its items. */
export interface MenuSpec {
  readonly head?: string;
  readonly items: readonly MenuItem[];
}

/** A vertical span in the window, in CSS px. */
export interface Span {
  readonly top: number;
  readonly bottom: number;
}

/** A box in the window, in CSS px, as `getBoundingClientRect` gives it. */
export interface Box extends Span {
  readonly left: number;
  readonly right: number;
}

/** The press that opened the menu. */
export interface OpeningPress extends Point {
  readonly pointerType: string;
  /** A touch's or pen's pointer, still down: the menu follows it for slide-to-choose. */
  readonly pointerId?: number;
  /** For touch, the pressed lane: the menu opens under it. */
  readonly lane?: Span;
}

/** Touch or pen sizes the menu for a finger; anything else is a mouse (decision 5). */
export type MenuMode = 'mouse' | 'touch';

export const menuMode = (pointerType: string): MenuMode =>
  longPressOpens(pointerType) ? 'touch' : 'mouse';

/** The sizes a menu in `mode` is drawn at. */
export const menuSize = (mode: MenuMode, sizes: typeof MENU_SIZES = MENU_SIZES): MenuSizeTable =>
  sizes[mode];

/** The tag a row shows at `size`: a keyboard hint only where the size keeps them. */
export const rowTag = (row: MenuRow, size: MenuSizeTable): string | null =>
  row.tag === undefined || (row.kbd === true && !size.keyboardTags) ? null : row.tag;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(value, high));

/** The room between the two edge gaps of a viewport `length` long. */
const room = (length: number, edge: number): number => Math.max(0, length - edge - edge);

/**
 * A mouse's menu: its top-left corner at the pointer, flipped to the
 * pointer's left when the right has no room and above it when the bottom
 * has none, then clamped inside the window, as the ⋯ menus are.
 */
export function mousePlacement(
  at: Point,
  menu: BoxSize,
  viewport: BoxSize,
  table: MousePlaceTable = MOUSE_PLACE,
): MenuPlacement {
  const rightOfPointer = at.x + table.gapPx + menu.width;
  const right =
    rightOfPointer <= viewport.width - table.edgePx ? rightOfPointer : at.x - table.gapPx;
  const opener = { top: at.y, bottom: at.y, right };
  return rowMenuPlacement({ opener, menu, viewport }, table.gapPx, table.edgePx);
}

/** What a touch-opened menu is placed against: the finger and the pressed lane. */
export interface TouchPlacementRequest {
  readonly at: Point;
  readonly lane: Span;
  readonly menu: BoxSize;
  readonly viewport: BoxSize;
}

/**
 * A finger's menu (decision 6): its right edge a fingertip left of the touch
 * point and its top just under the pressed lane, so the hand covers neither
 * the menu nor the lane. With no room on the left it goes right of the
 * finger; then it is clamped inside the window, so a menu too tall for the
 * room under the lane slides up only as far as the bottom edge needs.
 */
export function touchPlacement(
  { at, lane, menu, viewport }: TouchPlacementRequest,
  table: TouchPlaceTable = TOUCH_PLACE,
): MenuPlacement {
  const edge = table.edgePx;
  const maxWidth = room(viewport.width, edge);
  const maxHeight = room(viewport.height, edge);
  const width = Math.min(menu.width, maxWidth);
  const height = Math.min(menu.height, maxHeight);
  const leftOfFinger = at.x - table.besideFingerPx - width;
  const left = leftOfFinger >= edge ? leftOfFinger : at.x + table.besideFingerPx;
  return {
    left: clamp(left, edge, viewport.width - edge - width),
    top: clamp(lane.bottom + table.belowLanePx, edge, viewport.height - edge - height),
    maxWidth,
    maxHeight,
  };
}

/** Where the menu opened by `press` sits; a touch press with no lane is its own lane. */
export function menuPlacement(
  press: OpeningPress,
  menu: BoxSize,
  viewport: BoxSize,
): MenuPlacement {
  if (menuMode(press.pointerType) === 'mouse') return mousePlacement(press, menu, viewport);
  const lane = press.lane ?? { top: press.y, bottom: press.y };
  return touchPlacement({ at: press, lane, menu, viewport });
}

/** What a mouse's submenu is placed against: its parent menu and its row. */
export interface SubmenuPlacementRequest {
  readonly parent: Box;
  readonly row: Span;
  readonly menu: BoxSize;
  readonly viewport: BoxSize;
}

/**
 * A mouse's submenu: beside its parent, overlapping it a little, its first
 * row level with the row that opened it; left of the parent when the right
 * has no room; clamped inside the window.
 */
export function submenuPlacement(
  { parent, row, menu, viewport }: SubmenuPlacementRequest,
  table: MousePlaceTable = MOUSE_PLACE,
): MenuPlacement {
  const edge = table.edgePx;
  const maxWidth = room(viewport.width, edge);
  const maxHeight = room(viewport.height, edge);
  const width = Math.min(menu.width, maxWidth);
  const height = Math.min(menu.height, maxHeight);
  const right = parent.right - table.submenuOverlapPx;
  const left =
    right + width <= viewport.width - edge ? right : parent.left - width + table.submenuOverlapPx;
  return {
    left: clamp(left, edge, viewport.width - edge - width),
    top: clamp(row.top - table.submenuRisePx, edge, viewport.height - edge - height),
    maxWidth,
    maxHeight,
  };
}

/** A drilled-in touch submenu's back row: `‹ <parent label>`. */
export interface MenuBack {
  readonly kind: 'back';
  readonly label: string;
}

export type ShownItem = MenuItem | MenuBack;

/**
 * The items a touch menu shows down `path`, the indices of the submenus
 * drilled into: the spec's own at the top, else a back row to the parent,
 * a separator and the submenu's items, all in the one panel.
 */
export function shownItems(spec: MenuSpec, path: readonly number[]): readonly ShownItem[] {
  let items = spec.items;
  let label: string | null = null;
  for (const index of path) {
    const item = items[index];
    if (item?.kind !== 'submenu') break;
    ({ items, label } = item);
  }
  return label === null ? items : [{ kind: 'back', label }, SEPARATOR, ...items];
}

/** What a press on a shown item does: run a row, drill into a submenu, go back, or nothing. */
export type MenuChoice =
  | { readonly kind: 'run'; readonly row: MenuRow }
  | { readonly kind: 'open'; readonly index: number; readonly submenu: MenuSubmenu }
  | { readonly kind: 'back' }
  | { readonly kind: 'none' };

/** A tap, a click or a lift on item `index`; a separator, a disabled row or no row does nothing. */
export function choose(items: readonly ShownItem[], index: number | null): MenuChoice {
  const item = index === null ? undefined : items[index];
  if (item === undefined || index === null || item.kind === 'separator') return { kind: 'none' };
  if (item.kind === 'back') return { kind: 'back' };
  if (item.kind === 'submenu') return { kind: 'open', index, submenu: item };
  return item.disabled === true ? { kind: 'none' } : { kind: 'run', row: item };
}

/** The item whose box holds `at`, or none: a slide off the menu lights nothing. */
export function itemUnder(boxes: readonly (Box | null)[], at: Point): number | null {
  const index = boxes.findIndex(
    (box) =>
      box !== null && at.x >= box.left && at.x < box.right && at.y >= box.top && at.y < box.bottom,
  );
  return index < 0 ? null : index;
}

/** The row now previewed, and the calls that move the preview there. */
export interface PreviewMove {
  readonly previewed: MenuRow | null;
  readonly unpreview: MenuRow | null;
  readonly preview: MenuRow | null;
}

/**
 * The pointer or the finger is now over `next` (or nothing): an enabled row
 * previews, and the row previewed before is unpreviewed first. A disabled
 * row, a submenu, the back row and a separator preview nothing.
 */
export function movePreview(current: MenuRow | null, next: ShownItem | undefined): PreviewMove {
  const row = next?.kind === 'row' && next.disabled !== true ? next : null;
  if (row === current) return { previewed: current, unpreview: null, preview: null };
  return { previewed: row, unpreview: current, preview: row };
}

/**
 * The one open menu (windsor#834): opening a menu closes the one before, and
 * each menu's close runs its `teardown` exactly once, whatever closes it (a
 * row, Escape, a press outside, a scroll, a key, a blur, a resize, or the
 * next opening). A close of a menu already closed or replaced does nothing.
 */
export class MenuSlot {
  private current: (() => void) | null = null;

  /** Make `teardown`'s menu the open one, closing the one before; returns its close. */
  open(teardown: () => void): () => void {
    this.close();
    const close = (): void => {
      if (this.current !== close) return;
      this.current = null;
      teardown();
    };
    this.current = close;
    return close;
  }

  /** Close the open menu, if one is. */
  close(): void {
    this.current?.();
  }

  /** True while a menu is open. */
  get isOpen(): boolean {
    return this.current !== null;
  }
}

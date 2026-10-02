/**
 * A song row's ⋯ menu (windsor#434 decision 3, mockup
 * `docs/design/song-library-mockup.html`): Open, Rename…, Edit tags…,
 * Duplicate, Export .json, a divider, Delete…. A song this build can't open
 * keeps Export .json and Delete… only, and the open song's menu has no Open.
 * One menu is open at a time; a click elsewhere or Escape closes it.
 */
import { el } from './dom';
import type { SongRow } from './songListModel';
import { rowMenuPlacement } from './songRowMenuPlacement';

/** What a row's buttons do; the section implements them over `ctx.songs`. */
export interface RowActions {
  open(row: SongRow, opener: HTMLElement): void;
  newFrom(row: SongRow, opener: HTMLElement): void;
  rename(row: SongRow, opener: HTMLElement): void;
  editTags(row: SongRow, opener: HTMLElement): void;
  duplicate(row: SongRow): void;
  exportJson(row: SongRow): void;
  remove(row: SongRow, opener: HTMLElement): void;
}

interface MenuItem {
  readonly label: string;
  readonly run: (actions: RowActions, row: SongRow, opener: HTMLElement) => void;
  readonly danger?: boolean;
  /** Offered for a song this build can't open. */
  readonly refused?: boolean;
}

const OPEN: MenuItem = { label: 'Open', run: (a, row, opener) => a.open(row, opener) };
const EDITS: readonly MenuItem[] = [
  { label: 'Rename…', run: (a, row, opener) => a.rename(row, opener) },
  { label: 'Edit tags…', run: (a, row, opener) => a.editTags(row, opener) },
  { label: 'Duplicate', run: (a, row) => a.duplicate(row) },
  { label: 'Export .json', run: (a, row) => a.exportJson(row), refused: true },
];
const DELETE: MenuItem = {
  label: 'Delete…',
  run: (a, row, opener) => a.remove(row, opener),
  danger: true,
  refused: true,
};

/** The items a row's menu offers, divider aside. */
export function menuItems(row: SongRow): { items: MenuItem[]; danger: MenuItem } {
  const items = row.open ? [...EDITS] : [OPEN, ...EDITS];
  return {
    items: row.refusal === null ? items : items.filter((item) => item.refused),
    danger: DELETE,
  };
}

let closeOpenMenu: (() => void) | null = null;

function menuButton(item: MenuItem, act: () => void): HTMLElement {
  const b = el('button', item.danger ? 'danger' : '', item.label) as HTMLButtonElement;
  b.type = 'button';
  b.setAttribute('role', 'menuitem');
  b.onclick = act;
  return b;
}

/** True while a row's menu is open: the clock's redraw waits rather than close it. */
export const rowMenuOpen = (): boolean => closeOpenMenu !== null;

/**
 * Redraw `scope` without losing a focused ⋯ button: a redraw (the clock's
 * tick, or the list after Rename… or Edit tags…) replaces every row, so the
 * focus moves to the same song's new ⋯ button rather than to the page.
 */
export function keepRowFocus(scope: HTMLElement, redraw: () => void): void {
  const active = document.activeElement;
  const id =
    active instanceof HTMLElement && scope.contains(active) ? active.dataset.songId : undefined;
  redraw();
  if (id === undefined) return;
  rowWithId(rowButtons(scope), id)?.focus();
}

/** What the focus lookups read of a ⋯ button: the song it belongs to and whether it is in the page. */
export interface RowFocusable {
  readonly isConnected: boolean;
  readonly dataset: { readonly songId?: string };
  focus(): void;
}

const rowButtons = (scope: HTMLElement): HTMLElement[] => [
  ...scope.querySelectorAll<HTMLElement>('[data-song-id]'),
];

function rowWithId<T extends RowFocusable>(rows: Iterable<T>, id: string): T | null {
  for (const row of rows) if (row.dataset.songId === id) return row;
  return null;
}

/**
 * The ⋯ button a closing dialog should give focus back to: its opener while
 * that is still in the page, else the same song's button in the redrawn
 * table (the clock's redraw replaces every row while a dialog is up), else
 * nothing, when the song itself is gone.
 */
export function liveRowButton<T extends RowFocusable>(opener: T, rows: Iterable<T>): T | null {
  if (opener.isConnected) return opener;
  const id = opener.dataset.songId;
  return id === undefined ? null : rowWithId(rows, id);
}

/** After a row's dialog closes: focus the song's current ⋯ button when its opener was redrawn away. */
export function refocusRow(scope: HTMLElement, opener: HTMLElement): void {
  if (opener.isConnected) return;
  liveRowButton(opener, rowButtons(scope))?.focus();
}

/** Place the menu under `more` (above it when there is no room below), inside the viewport. */
function place(menu: HTMLElement, more: HTMLElement): void {
  const { top, left } = rowMenuPlacement({
    opener: more.getBoundingClientRect(),
    menu: { width: menu.offsetWidth, height: menu.offsetHeight },
    viewport: {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    },
  });
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

/**
 * The ⋯ button and, while it is open, its menu. The menu sits in the page
 * above everything, so the table's scroll box never clips it; a scroll, a
 * click elsewhere or Escape closes it.
 */
export function rowMenuButton(row: SongRow, actions: RowActions): HTMLElement {
  const more = el('button', 'btn small', '⋯') as HTMLButtonElement;
  more.type = 'button';
  more.setAttribute('aria-label', `More for ${row.name}`);
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.dataset.songId = row.id;
  more.onclick = (event): void => {
    event.stopPropagation();
    const wasOpen = more.getAttribute('aria-expanded') === 'true';
    closeOpenMenu?.();
    if (wasOpen) return;
    const menu = el('div', 'song-menu');
    menu.setAttribute('role', 'menu');
    const close = (): void => {
      menu.remove();
      more.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('scroll', close, true);
      if (closeOpenMenu === close) closeOpenMenu = null;
    };
    const outside = (e: PointerEvent): void => {
      if (!menu.contains(e.target as Node) && e.target !== more) close();
    };
    const escape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    const { items, danger } = menuItems(row);
    const act = (item: MenuItem) => (): void => {
      close();
      item.run(actions, row, more);
    };
    menu.append(
      ...items.map((item) => menuButton(item, act(item))),
      el('hr'),
      menuButton(danger, act(danger)),
    );
    document.body.appendChild(menu);
    place(menu, more);
    more.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('scroll', close, true);
    closeOpenMenu = close;
  };
  return more;
}

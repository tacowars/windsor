/**
 * The operator Sync picker (windsor#649, mockup
 * `docs/research/2026-10-09-operator-sync-mockup/mockup.html`, "Beside the
 * wave picker"): a face on each operator's wave line that reads its master —
 * `Sync` while off, `♪` for the note, else the master's letter in that
 * operator's colour — and opens the menu `operatorSyncMenu.ts` words.
 *
 * The menu hangs in the page above everything, as a song row's ⋯ menu does
 * (`songRowMenu.ts`), placed by the same `rowMenuPlacement`, so it opens on
 * screen from the top and the bottom rows at any width or zoom. One menu is
 * open at a time; a click or touch elsewhere, a scroll outside it or Escape
 * closes it. A choice writes `ops.<i>.sync` and pushes once, so undo,
 * autosave and the export follow, and every row's face repaints.
 */
import type { OpSync } from '@windsor/engine';
import { OP_NAMES } from '@windsor/engine';
import { el } from './dom';
import {
  masterIndex,
  syncFaceText,
  syncFaceTitle,
  syncMenuHeading,
  syncMenuItems,
  type SyncMenuItem,
} from './operatorSyncMenu';
import type { PatchEditor } from './partsSession';
import { scrollCloses } from './songRowMenu';
import { rowMenuPlacement } from './songRowMenuPlacement';

let closeOpenMenu: (() => void) | null = null;

/** Close the open Sync menu, if any: the bays call it before they rebuild. */
export const closeSyncMenu = (): void => closeOpenMenu?.();

const syncsOf = (editor: PatchEditor): OpSync[] => editor.patch.ops.map((op) => op.sync);

/** A synced face or menu letter takes its master operator's colour; the note's is the stylesheet's. */
function setMasterColor(node: HTMLElement, sync: OpSync, colors: readonly string[]): void {
  const color = colors[masterIndex(sync)];
  if (color) node.style.setProperty('--m-color', color);
  else node.style.removeProperty('--m-color');
}

/**
 * Hang the menu from the face's left edge, as the mockup draws it.
 * `rowMenuPlacement` lines up right edges, so the face hands it the right
 * edge a left-aligned menu would have; the placement still flips the menu
 * above the face and clamps it inside the viewport.
 */
function place(menu: HTMLElement, face: HTMLElement): void {
  const box = face.getBoundingClientRect();
  const { top, left, maxHeight, maxWidth } = rowMenuPlacement({
    opener: { top: box.top, bottom: box.bottom, right: box.left + menu.offsetWidth },
    menu: { width: menu.offsetWidth, height: menu.offsetHeight },
    viewport: {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    },
  });
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  menu.style.maxHeight = `${maxHeight}px`;
  menu.style.setProperty('--sync-menu-cap', `${maxWidth}px`);
}

function menuButton(item: SyncMenuItem, colors: readonly string[]): HTMLButtonElement {
  const b = el('button') as HTMLButtonElement;
  b.type = 'button';
  b.setAttribute('role', 'menuitemradio');
  b.setAttribute('aria-checked', String(item.checked));
  b.disabled = item.disabled;
  setMasterColor(b, item.value, colors);
  b.append(el('span', 'g', item.glyph), el('span', '', item.label), el('span', 'h', item.hint));
  return b;
}

interface MenuRequest {
  readonly editor: PatchEditor;
  readonly i: number;
  readonly colors: readonly string[];
  readonly face: HTMLElement;
  readonly choose: (value: OpSync) => void;
}

/** Open operator `i`'s menu under its face, wired to close on any press, scroll or Escape outside it. */
function openMenu({ editor, i, colors, face, choose }: MenuRequest): void {
  const menu = el('div', 'sync-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', syncMenuHeading(i));
  const close = (): void => {
    menu.remove();
    face.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
    window.removeEventListener('scroll', scrolled, true);
    if (closeOpenMenu === close) closeOpenMenu = null;
  };
  const outside = (e: PointerEvent): void => {
    if (!menu.contains(e.target as Node) && !face.contains(e.target as Node)) close();
  };
  const escape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const scrolled = (e: Event): void => {
    if (scrollCloses(menu, e.target)) close();
  };
  menu.appendChild(el('div', 'mh', syncMenuHeading(i)));
  for (const item of syncMenuItems(syncsOf(editor), i)) {
    const b = menuButton(item, colors);
    b.onclick = (): void => {
      close();
      choose(item.value);
    };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  place(menu, face);
  face.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', escape, true);
  window.addEventListener('scroll', scrolled, true);
  closeOpenMenu = close;
}

/** One operator's face and the repaint that reads its sync field again. */
function syncFace(
  editor: PatchEditor,
  i: number,
  colors: readonly string[],
  onChoose: () => void,
): { face: HTMLButtonElement; paint: () => void } {
  const face = el('button', 'sync-face') as HTMLButtonElement;
  face.type = 'button';
  face.setAttribute('aria-haspopup', 'menu');
  face.setAttribute('aria-expanded', 'false');
  const paint = (): void => {
    const sync = editor.patch.ops[i]?.sync ?? 'off';
    face.textContent = syncFaceText(sync);
    face.title = syncFaceTitle(syncsOf(editor), i);
    face.setAttribute('aria-label', `Operator ${OP_NAMES[i]} sync: ${sync}`);
    face.classList.toggle('synced', sync !== 'off');
    setMasterColor(face, sync, colors);
  };
  const choose = (value: OpSync): void => {
    const target = editor.patch.ops[i];
    if (!target || target.sync === value) return;
    target.sync = value;
    editor.push();
    onChoose();
  };
  face.onclick = (event): void => {
    event.stopPropagation();
    const wasOpen = face.getAttribute('aria-expanded') === 'true';
    closeSyncMenu();
    if (!wasOpen) openMenu({ editor, i, colors, face, choose });
  };
  paint();
  return { face, paint };
}

/**
 * Every operator's Sync face, in operator order, `colors` each operator's
 * own. A choice on one repaints all four: a change can make or unmake
 * another row's loop, and the menus are built fresh on each open.
 */
export function syncPickers(editor: PatchEditor, colors: readonly string[]): HTMLElement[] {
  const paints: (() => void)[] = [];
  const repaint = (): void => paints.forEach((paint) => paint());
  return OP_NAMES.map((_, i) => {
    const { face, paint } = syncFace(editor, i, colors, repaint);
    paints.push(paint);
    return face;
  });
}

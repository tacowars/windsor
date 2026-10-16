/**
 * The context menu (windsor#825; record `2026-10-16-song-tab-context-menu`,
 * decisions 5–7 and 10; the approved mockups
 * `docs/design/song-region-menu-mockup.html` and
 * `docs/design/song-region-menu-tablet-mockup.html`): one menu for a mouse's
 * right-click and a finger's long press, drawn from a `MenuSpec` over
 * `contextMenuModel.ts`. The opening press's `pointerType` sizes it, never a
 * media query.
 *
 * - **Mouse:** it opens at the pointer. Hovering a row previews it, and a
 *   click runs it; a submenu opens beside its row on hover or click.
 * - **Touch or pen:** it opens below-left of the finger, under the pressed
 *   lane, with 44 px rows and no keyboard tags. While the finger that opened
 *   it is still down, the row under it lights and previews, and lifting on
 *   it runs it (lifting off every row leaves the menu open); a later tap
 *   runs a row. A submenu drills in, under a back row.
 *
 * Running a row closes the menu, then calls its `run()`. Escape, a press
 * outside, a scroll, a resize or the window losing focus close it too. One
 * menu is open at a time, and the focus goes back where it was. It hangs
 * from the page body at a fixed position, as the knob's menu does.
 */
import type { Box, MenuItem, MenuRow, MenuSpec, OpeningPress, ShownItem } from './contextMenuModel';
import {
  choose,
  itemUnder,
  menuMode,
  menuPlacement,
  menuSize,
  movePreview,
  rowTag,
  shownItems,
  submenuPlacement,
} from './contextMenuModel';
import type { MenuMode } from './contextMenuModel';
import type { MenuSizeTable } from './contextMenuTables';
import { el } from './dom';
import type { MenuPlacement } from './songRowMenuPlacement';

/** The open menu's close, so a second opening replaces the first. */
let closeOpen: (() => void) | null = null;

/** Close the open context menu, if one is, running nothing. */
export function closeContextMenu(): void {
  closeOpen?.();
}

/** True while a context menu is open. */
export const contextMenuOpen = (): boolean => closeOpen !== null;

const viewport = (): { width: number; height: number } => ({
  width: document.documentElement.clientWidth,
  height: document.documentElement.clientHeight,
});

function placeAt(node: HTMLElement, { top, left, maxHeight, maxWidth }: MenuPlacement): void {
  node.style.top = `${top}px`;
  node.style.left = `${left}px`;
  node.style.maxHeight = `${maxHeight}px`;
  node.style.maxWidth = `${maxWidth}px`;
}

/** An empty panel at the mode's sizes, which `console.css` reads as custom properties. */
function panelNode(mode: MenuMode, size: MenuSizeTable): HTMLElement {
  const node = el('div', mode === 'touch' ? 'context-menu touch' : 'context-menu');
  node.setAttribute('role', 'menu');
  node.style.setProperty('--ctx-row', `${size.rowPx}px`);
  node.style.setProperty('--ctx-label', `${size.labelPx}px`);
  node.style.setProperty('--ctx-min-width', `${size.minWidthPx}px`);
  node.addEventListener('contextmenu', (e) => e.preventDefault());
  return node;
}

/** One shown item: a separator line, or a button with its tag, ▸ or ‹. */
function itemNode(item: ShownItem, size: MenuSizeTable): HTMLElement {
  if (item.kind === 'separator') return el('hr');
  const button = el('button', item.kind === 'back' ? 'back' : '') as HTMLButtonElement;
  button.type = 'button';
  button.setAttribute('role', 'menuitem');
  if (item.kind === 'back') button.append(el('span', 'chev', '‹'));
  button.append(el('span', 'label', item.label));
  if (item.kind === 'submenu') {
    button.append(el('span', 'sub', '▸'));
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
  } else if (item.kind === 'row') {
    const tag = rowTag(item, size);
    if (tag !== null) button.append(el('span', 'tag', tag));
    button.disabled = item.disabled === true;
  }
  return button;
}

/** A panel on screen: the menu, or a mouse's submenu beside the row that opened it. */
interface Panel {
  readonly node: HTMLElement;
  items: readonly ShownItem[];
  nodes: readonly HTMLElement[];
  readonly opener: HTMLElement | null;
}

/** One open menu: its panels, its preview, the finger it follows and its listeners. */
class OpenMenu {
  private readonly mode: MenuMode;
  private readonly size: MenuSizeTable;
  private readonly panels: Panel[] = [];
  /** The submenus a touch menu has drilled into, as item indices. */
  private path: number[] = [];
  private previewed: MenuRow | null = null;
  private lit: HTMLElement | null = null;
  private sliding: boolean;
  private readonly before: Element | null = document.activeElement;

  constructor(
    private readonly spec: MenuSpec,
    private readonly press: OpeningPress,
  ) {
    this.mode = menuMode(press.pointerType);
    this.size = menuSize(this.mode);
    this.sliding = this.mode === 'touch' && press.pointerId !== undefined;
  }

  show(): void {
    const root: Panel = {
      node: panelNode(this.mode, this.size),
      items: [],
      nodes: [],
      opener: null,
    };
    this.panels.push(root);
    this.fill(0, shownItems(this.spec, this.path));
    document.body.append(root.node);
    const { offsetWidth: width, offsetHeight: height } = root.node;
    placeAt(root.node, menuPlacement(this.press, { width, height }, viewport()));
    document.addEventListener('pointerdown', this.outside, true);
    document.addEventListener('keydown', this.escape, true);
    window.addEventListener('scroll', this.scrolled, { capture: true, passive: true });
    window.addEventListener('blur', this.close);
    window.addEventListener('resize', this.close);
    if (!this.sliding) return;
    window.addEventListener('pointermove', this.slide, true);
    window.addEventListener('pointerup', this.lift, true);
    window.addEventListener('pointercancel', this.endSlide, true);
  }

  readonly close = (): void => {
    if (closeOpen !== this.close) return;
    closeOpen = null;
    this.light(null);
    const active = document.activeElement;
    const inside = this.panels.some((panel) => panel.node.contains(active));
    for (const panel of this.panels) panel.node.remove();
    this.panels.length = 0;
    document.removeEventListener('pointerdown', this.outside, true);
    document.removeEventListener('keydown', this.escape, true);
    window.removeEventListener('scroll', this.scrolled, true);
    window.removeEventListener('blur', this.close);
    window.removeEventListener('resize', this.close);
    this.endSlide();
    const back = this.before;
    if ((inside || document.activeElement === document.body) && back instanceof HTMLElement) {
      if (back.isConnected) back.focus({ preventScroll: true });
    }
  };

  /** Draw `items` into panel `k`, the head line on the menu itself. */
  private fill(k: number, items: readonly ShownItem[]): void {
    const panel = this.panels[k];
    if (!panel) return;
    panel.items = items;
    panel.nodes = items.map((item) => itemNode(item, this.size));
    panel.nodes.forEach((node, i) => this.wire(node, k, i));
    const head = k === 0 && this.spec.head !== undefined;
    panel.node.replaceChildren(
      ...(head ? [el('div', 'context-menu-head', this.spec.head)] : []),
      ...panel.nodes,
    );
  }

  private wire(node: HTMLElement, k: number, i: number): void {
    const byMouse = (e: PointerEvent): boolean =>
      this.mode === 'mouse' && e.pointerType === 'mouse';
    node.addEventListener('pointerenter', (e) => {
      if (byMouse(e)) this.hover(k, i);
    });
    node.addEventListener('pointerleave', (e) => {
      if (byMouse(e)) this.light(null);
    });
    node.addEventListener('click', () => this.pick(k, i));
  }

  /** The mouse is over item `i` of panel `k`: its submenu opens, any deeper one closes. */
  private hover(k: number, i: number): void {
    const item = this.panels[k]?.items[i];
    if (item?.kind === 'submenu') this.openBeside(k, i, item.items);
    else this.closeAfter(k);
    this.light({ k, i });
  }

  /** Light and preview item `i` of panel `k`, or nothing, moving the preview off the last row. */
  private light(at: { k: number; i: number } | null): void {
    const item = at && this.panels[at.k]?.items[at.i];
    const node = (at && this.panels[at.k]?.nodes[at.i]) ?? null;
    const move = movePreview(this.previewed, item ?? undefined);
    this.previewed = move.previewed;
    move.unpreview?.unpreview?.();
    move.preview?.preview?.();
    if (node === this.lit) return;
    this.lit?.classList.remove('hl');
    this.lit = node instanceof HTMLButtonElement ? node : null;
    this.lit?.classList.add('hl');
  }

  /** A click, a tap or a lift on item `i` of panel `k`. */
  private pick(k: number, i: number): void {
    const panel = this.panels[k];
    if (!panel) return;
    const choice = choose(panel.items, i);
    if (choice.kind === 'run') {
      this.close();
      choice.row.run();
    } else if (choice.kind === 'open') {
      if (this.mode === 'mouse') this.openBeside(k, i, choice.submenu.items);
      else this.drill([...this.path, choice.index]);
    } else if (choice.kind === 'back') {
      this.drill(this.path.slice(0, -1));
    }
  }

  /** Touch: show the rows down `path` in the menu itself, at its top-left and no narrower. */
  private drill(path: number[]): void {
    const root = this.panels[0];
    if (!root) return;
    this.light(null);
    if (root.node.style.minWidth === '') root.node.style.minWidth = `${root.node.offsetWidth}px`;
    this.path = path;
    this.fill(0, shownItems(this.spec, path));
  }

  /** Mouse: open item `i`'s submenu beside panel `k`, unless it is already open. */
  private openBeside(k: number, i: number, items: readonly MenuItem[]): void {
    const parent = this.panels[k];
    const opener = parent?.nodes[i];
    if (!parent || !opener || this.panels[k + 1]?.opener === opener) return;
    this.closeAfter(k);
    const node = panelNode(this.mode, this.size);
    this.panels.push({ node, items: [], nodes: [], opener });
    this.fill(k + 1, items);
    document.body.append(node);
    const menu = { width: node.offsetWidth, height: node.offsetHeight };
    const request = {
      parent: parent.node.getBoundingClientRect(),
      row: opener.getBoundingClientRect(),
      menu,
      viewport: viewport(),
    };
    placeAt(node, submenuPlacement(request));
    opener.classList.add('open');
    opener.setAttribute('aria-expanded', 'true');
  }

  /** Close every submenu deeper than panel `k`. */
  private closeAfter(k: number): void {
    for (const panel of this.panels.splice(k + 1)) {
      panel.node.remove();
      panel.opener?.classList.remove('open');
      panel.opener?.setAttribute('aria-expanded', 'false');
    }
  }

  private readonly inMenu = (target: EventTarget | null): boolean =>
    target instanceof Node && this.panels.some((panel) => panel.node.contains(target));

  private readonly outside = (e: PointerEvent): void => {
    if (!this.inMenu(e.target)) this.close();
  };

  private readonly escape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    this.close();
  };

  private readonly scrolled = (e: Event): void => {
    if (!this.inMenu(e.target)) this.close();
  };

  /** The item of the menu under the opening finger, if any. */
  private underFinger(e: PointerEvent): number | null {
    const boxes: (Box | null)[] = (this.panels[0]?.nodes ?? []).map((node) =>
      node instanceof HTMLButtonElement ? node.getBoundingClientRect() : null,
    );
    return itemUnder(boxes, { x: e.clientX, y: e.clientY });
  }

  /** Slide-to-choose: the opening finger moved, so the row under it lights and previews. */
  private readonly slide = (e: PointerEvent): void => {
    if (e.pointerId !== this.press.pointerId) return;
    const i = this.underFinger(e);
    this.light(i === null ? null : { k: 0, i });
  };

  /** The opening finger lifted: on a row, that row is chosen; off every row, the menu stays. */
  private readonly lift = (e: PointerEvent): void => {
    if (e.pointerId !== this.press.pointerId) return;
    const i = this.underFinger(e);
    this.endSlide();
    this.light(null);
    if (i !== null) this.pick(0, i);
  };

  /** The opening finger is up, or the platform took it: stop following it. */
  private readonly endSlide = (): void => {
    if (!this.sliding) return;
    this.sliding = false;
    this.light(null);
    window.removeEventListener('pointermove', this.slide, true);
    window.removeEventListener('pointerup', this.lift, true);
    window.removeEventListener('pointercancel', this.endSlide, true);
  };
}

/**
 * Open the menu `spec` describes for `press`, closing any other. A touch or
 * pen press that passes its `pointerId` is followed for slide-to-choose
 * until it lifts. Returns this menu's close, which does nothing once the
 * menu has closed or another has replaced it.
 */
export function openContextMenu(spec: MenuSpec, press: OpeningPress): () => void {
  closeOpen?.();
  const menu = new OpenMenu(spec, press);
  closeOpen = menu.close;
  menu.show();
  return menu.close;
}

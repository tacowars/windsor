/**
 * The patch bar's ⋯ menu (windsor#521 decision 2): a short list of today's
 * rail actions under a button, closed by a pick, Esc or a click outside.
 * The entries come from their owners (`patchLibrary.ts`, `libraryActions.ts`,
 * the tab's Patch JSON); this file only draws and dismisses the list. An
 * entry with a `form` swaps the list for that form (Rename's field).
 *
 * The keys follow the WAI-ARIA menu pattern (windsor#537 decision 1): Enter
 * on ⋯ opens it on the first enabled item, ↑ ↓ Home End move
 * (`patchMenuKeys.ts`), Esc closes it back to ⋯, and Tab closes it and lets
 * the tab switch through. A pick hands focus to ⋯ before its action runs, so
 * a dialog it opens returns there; once the action settles (an async one
 * included, whether it finished, failed or was cancelled) and focus fell to
 * the page body, ⋯ takes it back, or the new ⋯ (found by its id) when the
 * action rebuilt the bar.
 */
import { el } from './dom';
import { moveMenuFocus } from './patchMenuKeys';

/** The ⋯ button's id: a rebuilt bar's ⋯ is found again by it. */
export const PATCH_MENU_ID = 'patchMenu';

export interface MenuAction {
  readonly kind: 'action';
  readonly label: string;
  readonly title: string;
  readonly enabled: boolean;
  /**
   * `opener` is the ⋯ button, where a modal hands focus back. An async action
   * returns its promise, so the menu restores focus after it settles; the
   * action reports its own failure.
   */
  readonly run: (opener: HTMLElement) => void | Promise<void>;
}

export interface MenuForm {
  readonly kind: 'form';
  readonly label: string;
  readonly title: string;
  /** The form that replaces the list; `close` dismisses the menu. */
  readonly form: (close: () => void) => HTMLElement;
}

export type MenuItem =
  | MenuAction
  | MenuForm
  | { readonly kind: 'separator' }
  | { readonly kind: 'node'; readonly node: HTMLElement };

export const SEPARATOR: MenuItem = { kind: 'separator' };

function itemButton(label: string, title: string, enabled: boolean): HTMLButtonElement {
  const node = el('button', 'patch-menu-item', label) as HTMLButtonElement;
  node.type = 'button';
  node.title = title;
  node.disabled = !enabled;
  node.setAttribute('role', 'menuitem');
  return node;
}

/**
 * After an entry's action: if focus fell to the page, focus ⋯, or the new ⋯
 * when the action rebuilt the bar, so the keyboard still has a control. An
 * action that opened a dialog leaves focus in it, and the dialog hands it
 * back on close.
 */
export function refocusMenu(toggle: HTMLElement): void {
  queueMicrotask(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    (toggle.isConnected ? toggle : document.getElementById(toggle.id))?.focus();
  });
}

/** Run a pick's action, then restore focus once it settles, success or not. */
function runAction(item: MenuAction, toggle: HTMLElement): void {
  const restore = (): void => refocusMenu(toggle);
  try {
    Promise.resolve(item.run(toggle)).then(restore, restore);
  } catch (error) {
    restore();
    throw error;
  }
}

/** The ⋯ button and its menu, built on each open from `items`. */
// eslint-disable-next-line max-lines-per-function -- one menu: the toggle, close, fill and the keys, wired in order
export function patchMenu(title: string, items: () => readonly MenuItem[]): HTMLElement {
  const wrap = el('div', 'patch-menu-wrap');
  const toggle = el('button', 'btn icon', '⋯') as HTMLButtonElement;
  toggle.type = 'button';
  toggle.id = PATCH_MENU_ID;
  toggle.title = title;
  toggle.setAttribute('aria-label', 'Patch actions');
  toggle.setAttribute('aria-haspopup', 'menu');
  toggle.setAttribute('aria-expanded', 'false');
  let menu: HTMLElement | null = null;
  const outside = (event: PointerEvent): void => {
    if (!(event.target instanceof Node) || !wrap.contains(event.target)) close();
  };
  function close(): void {
    menu?.remove();
    menu = null;
    toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
  }
  const fill = (box: HTMLElement): void => {
    for (const item of items()) {
      if (item.kind === 'separator') box.appendChild(el('hr', 'patch-menu-sep'));
      else if (item.kind === 'node') box.appendChild(item.node);
      else if (item.kind === 'form') {
        const button = itemButton(item.label, item.title, true);
        button.onclick = (): void => {
          box.replaceChildren(item.form(close));
          // A submitted form may rebuild the bar (Rename re-renders the tab).
          box.addEventListener('submit', () => refocusMenu(toggle));
        };
        box.appendChild(button);
      } else {
        const button = itemButton(item.label, item.title, item.enabled);
        button.onclick = (): void => {
          close();
          toggle.focus();
          runAction(item, toggle);
        };
        box.appendChild(button);
      }
    }
  };
  toggle.onclick = (): void => {
    if (menu) return close();
    menu = el('div', 'patch-menu');
    menu.setAttribute('role', 'menu');
    menu.onkeydown = (event): void => {
      // Tab leaves the menu (and may switch tabs, `tabShell.ts`): close it so a
      // hidden tab never keeps it open. Let the key through.
      if (event.key === 'Tab') return close();
      // The arrows walk the items (and an old-format row's buttons); inside
      // Rename's field they stay the field's.
      if (event.target instanceof HTMLButtonElement) {
        const items = [...(menu?.querySelectorAll('button') ?? [])];
        if (moveMenuFocus(items, event)) return;
      }
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
      toggle.focus();
    };
    fill(menu);
    wrap.appendChild(menu);
    toggle.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    menu.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  };
  wrap.appendChild(toggle);
  return wrap;
}

/**
 * The patch bar's ⋯ menu (windsor#521 decision 2): a short list of today's
 * rail actions under a button, closed by a pick, Esc or a click outside.
 * The entries come from their owners (`patchLibrary.ts`, `libraryActions.ts`,
 * the tab's Patch JSON); this file only draws and dismisses the list. An
 * entry with a `form` swaps the list for that form (Rename's field).
 */
import { el } from './dom';

export interface MenuAction {
  readonly kind: 'action';
  readonly label: string;
  readonly title: string;
  readonly enabled: boolean;
  /** `opener` is the ⋯ button, where a modal hands focus back. */
  readonly run: (opener: HTMLElement) => void;
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

/** The ⋯ button and its menu, built on each open from `items`. */
export function patchMenu(title: string, items: () => readonly MenuItem[]): HTMLElement {
  const wrap = el('div', 'patch-menu-wrap');
  const toggle = el('button', 'btn icon', '⋯') as HTMLButtonElement;
  toggle.type = 'button';
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
        button.onclick = (): void => box.replaceChildren(item.form(close));
        box.appendChild(button);
      } else {
        const button = itemButton(item.label, item.title, item.enabled);
        button.onclick = (): void => {
          close();
          item.run(toggle);
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

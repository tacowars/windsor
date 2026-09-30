/**
 * The rack's Add slots and the picker they open (windsor#173 decision 7; the
 * mockup's `.add-slot` and `.picker`,
 * `docs/research/2026-09-30-insert-rack/mockup.html`).
 *
 * A slot is a button at the rack's height: `+` over "Add insert". Pressing
 * it puts the picker in its place: a panel at the same height with a header
 * ("Add insert" and ✕) and a scrolling list of the kinds under their groups
 * (`INSERT_GROUPS`). Opening moves the focus to the first kind; ↑ ↓ (and
 * Home, End) move through the kinds, Enter picks one. Picking adds it and
 * closes the picker; Escape, ✕ or a press outside closes it without adding,
 * and Escape and ✕ hand the focus back to the slot. One picker is open at a
 * time across every rack.
 */
import type { InsertKindName } from '@windsor/engine';
import { el } from './dom';
import { INSERT_GROUPS, INSERT_LABELS } from './insertKnobTables';

export interface AddSlotSpec {
  /** Whether the chain is full: the slot is then disabled and says why in `title`. */
  readonly disabled: boolean;
  readonly title: string;
  /** Add `kind`; called once the picker has closed. */
  pick(kind: InsertKindName): void;
}

/** The picker open now, anywhere on the page, as the way to close it. */
let openPicker: ((restoreFocus: boolean) => void) | null = null;

const ADD_PROMPT = 'Add insert';

function pickerList(pick: (kind: InsertKindName) => void): HTMLElement {
  const list = el('div', 'insert-picker-list');
  INSERT_GROUPS.forEach((group, at) => {
    const box = el('div', 'insert-picker-group');
    box.setAttribute('role', 'group');
    const heading = el('div', 'insert-picker-label', group.label);
    heading.id = `insert-picker-group-${at}`;
    box.setAttribute('aria-labelledby', heading.id);
    box.appendChild(heading);
    for (const kind of group.kinds) {
      const item = el('button', 'insert-picker-item', INSERT_LABELS[kind]) as HTMLButtonElement;
      item.type = 'button';
      item.dataset.kind = kind;
      item.onclick = (): void => pick(kind);
      box.appendChild(item);
    }
    list.appendChild(box);
  });
  return list;
}

/** ↑ ↓ Home End move the focus through `items`; the key is then handled. */
function moveFocus(items: readonly HTMLElement[], key: string): boolean {
  const at = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  const to =
    key === 'ArrowDown'
      ? Math.min(last, at + 1)
      : key === 'ArrowUp'
        ? Math.max(0, at - 1)
        : key === 'Home'
          ? 0
          : key === 'End'
            ? last
            : null;
  if (to === null) return false;
  items[to]?.focus();
  return true;
}

function openIn(slot: HTMLButtonElement, spec: AddSlotSpec): void {
  openPicker?.(false);
  const panel = el('div', 'insert-picker');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', slot.getAttribute('aria-label') ?? ADD_PROMPT);
  const head = el('div', 'insert-picker-head');
  const close = el('button', 'insert-icon', '✕') as HTMLButtonElement;
  close.type = 'button';
  close.title = 'Close';
  close.setAttribute('aria-label', 'Close the insert picker');
  head.append(el('span', '', ADD_PROMPT), close);
  const shut = (restoreFocus: boolean): void => {
    if (openPicker !== shut) return;
    openPicker = null;
    document.removeEventListener('pointerdown', outside, true);
    if (panel.isConnected) panel.replaceWith(slot);
    if (restoreFocus) slot.focus();
  };
  const outside = (event: PointerEvent): void => {
    if (!panel.contains(event.target as Node)) shut(false);
  };
  const list = pickerList((kind) => {
    shut(false);
    spec.pick(kind);
  });
  const items = [...list.querySelectorAll<HTMLElement>('.insert-picker-item')];
  close.onclick = (): void => shut(true);
  panel.onkeydown = (event): void => {
    if (event.key === 'Escape') shut(true);
    else if (!moveFocus(items, event.key)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  panel.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null;
    if (next && !panel.contains(next)) shut(false);
  });
  panel.append(head, list);
  slot.replaceWith(panel);
  openPicker = shut;
  document.addEventListener('pointerdown', outside, true);
  items[0]?.focus();
}

/** An Add slot: a button that opens the picker in its place. */
export function addSlot(spec: AddSlotSpec): HTMLButtonElement {
  const slot = el('button', 'insert-add') as HTMLButtonElement;
  slot.type = 'button';
  slot.append(el('b', '', '+'), el('span', '', ADD_PROMPT));
  slot.disabled = spec.disabled;
  slot.title = spec.title;
  slot.onclick = (): void => openIn(slot, spec);
  return slot;
}

/**
 * A knob's right-click menu (windsor#785, record `2026-10-13-midi-cc-mapping`
 * decision 12, the approved mockup's `.ctx`): the DOM over
 * `knobCcMenuModel.ts`. **Learn MIDI CC…** opens the CC panel listening for
 * the knob's target, **Edit mapping…** opens it at the mapping's row (both
 * through `ccPanelEntry.ts`), and **Remove CC <n>** drops the mapping as one
 * song edit. A knob whose target no CC can move keeps the browser's menu.
 *
 * One menu is open at a time; a press elsewhere, Escape or a scroll closes it.
 */
import { partAt } from '@windsor/engine';

import { learnCcMapping, openCcMapping } from './ccPanelEntry';
import { withoutMapping } from './ccPanelEdits';
import { partPatch } from './ccPanelEngine';
import { CC_EDIT_LABEL, ccMappingsChange } from './ccPanelSession';
import { el } from './dom';
import type { KnobAutomation } from './knobAutomation';
import type { KnobCcAt, KnobCcBinding } from './knobCc';
import { type KnobCcMenuItem, knobCcMenu } from './knobCcMenuModel';
import { scrollCloses } from './songRowMenu';
import { rowMenuPlacement } from './songRowMenuPlacement';

/** What the knob hands its menu: its binding, its lock now and its label now. */
export interface KnobCcMenuSource {
  readonly binding: KnobCcBinding;
  lock(): KnobAutomation | null;
  label(): string;
}

let closeOpen: (() => void) | null = null;

/** Do what `action` names for the knob at `at`. */
function run(item: KnobCcMenuItem, binding: KnobCcBinding, at: KnobCcAt): void {
  const { part, target } = at;
  if (part === null) return;
  if (item.action === 'learn') learnCcMapping(part, target);
  else if (item.action === 'edit') openCcMapping(part, target);
  else {
    const list = partAt(binding.scope.doc(), part)?.ccMappings ?? [];
    binding.scope.change(ccMappingsChange(part, withoutMapping(list, target)), CC_EDIT_LABEL);
  }
}

function menuButton(item: KnobCcMenuItem, act: () => void): HTMLButtonElement {
  const b = el('button', item.danger ? 'danger' : '', item.label) as HTMLButtonElement;
  b.type = 'button';
  b.setAttribute('role', 'menuitem');
  if (item.tag !== null) b.append(el('span', 'tag', item.tag));
  if (item.refused !== null) {
    b.disabled = true;
    b.title = item.refused;
  }
  b.onclick = act;
  return b;
}

/** Under the knob, its left edge on the knob's, inside the viewport. */
function place(menu: HTMLElement, knob: HTMLElement): void {
  const box = knob.getBoundingClientRect();
  const { top, left } = rowMenuPlacement({
    opener: { top: box.top, bottom: box.bottom, right: box.left + menu.offsetWidth },
    menu: { width: menu.offsetWidth, height: menu.offsetHeight },
    viewport: {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    },
  });
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

/** Open the knob's menu over the page, closing any other. */
function open(knob: HTMLElement, source: KnobCcMenuSource, at: KnobCcAt): boolean {
  const { binding } = source;
  const doc = binding.scope.doc();
  const part = at.part === null ? undefined : partAt(doc, at.part);
  const model = knobCcMenu({
    at,
    part,
    patch: part && partPatch(doc, part),
    lock: source.lock(),
    label: source.label(),
  });
  if (!model) return false;
  closeOpen?.();
  const menu = el('div', 'knob-cc-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', model.head);
  const close = (): void => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
    window.removeEventListener('scroll', scrolled, true);
    if (closeOpen === close) closeOpen = null;
  };
  const outside = (e: PointerEvent): void => {
    if (!menu.contains(e.target as Node)) close();
  };
  const escape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const scrolled = (e: Event): void => {
    if (scrollCloses(menu, e.target)) close();
  };
  menu.append(el('div', 'knob-cc-menu-head', model.head));
  for (const entry of model.items) {
    if (entry.danger) menu.append(el('hr'));
    menu.append(
      menuButton(entry, () => {
        close();
        run(entry, binding, at);
      }),
    );
  }
  document.body.append(menu);
  place(menu, knob);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', escape, true);
  window.addEventListener('scroll', scrolled, true);
  closeOpen = close;
  return true;
}

/** Give `knob` its right-click menu: the browser's stays where the knob's target is none. */
export function attachKnobCcMenu(knob: HTMLElement, source: KnobCcMenuSource): void {
  knob.addEventListener('contextmenu', (e) => {
    const at = source.binding.at();
    if (at && open(knob, source, at)) e.preventDefault();
  });
}

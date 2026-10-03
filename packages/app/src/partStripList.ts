/**
 * The part strip's ▾ list (windsor#520 decision 6): shown only while the
 * chips overflow, it opens a list of every part — the name, then
 * `n · kind` — and choosing one picks it. It is a native `popover`, so a
 * click outside or Escape closes it, and it is filled from the document each
 * time it opens, never kept in step between.
 */
import type { AppCtx } from './context';
import { el } from './dom';
import { chipLabel } from './partStripModel';

export interface PartListPopover {
  readonly button: HTMLButtonElement;
  readonly popover: HTMLElement;
}

function fill(ctx: AppCtx, popover: HTMLElement, pick: (slot: number) => void): void {
  const rows = ctx.model.doc.parts.map((part, index) => {
    const label = chipLabel(part, index);
    const row = el('button', 'part-list-row') as HTMLButtonElement;
    row.type = 'button';
    row.title = part.name;
    row.style.setProperty('--tone', label.tone);
    if (part.slot === ctx.parts.selected) row.setAttribute('aria-current', 'true');
    row.append(el('span', 'n', label.name), el('span', 'k', label.meta));
    row.onclick = (): void => {
      popover.hidePopover();
      pick(part.slot);
    };
    return row;
  });
  popover.replaceChildren(...rows);
}

/** The ▾ button and the list it opens, placed under the button's right edge. */
export function partListPopover(ctx: AppCtx, pick: (slot: number) => void): PartListPopover {
  const popover = el('div', 'part-list');
  popover.id = 'partList';
  popover.popover = 'auto';
  popover.setAttribute('aria-label', 'All parts');
  const button = el('button', 'plist', '▾') as HTMLButtonElement;
  button.type = 'button';
  button.title = 'All parts';
  button.setAttribute('popovertarget', popover.id);
  popover.addEventListener('beforetoggle', (e) => {
    if ((e as ToggleEvent).newState !== 'open') return;
    fill(ctx, popover, pick);
    const box = button.getBoundingClientRect();
    popover.style.top = `${box.bottom}px`;
    popover.style.right = `${document.documentElement.clientWidth - box.right}px`;
  });
  return { button, popover };
}

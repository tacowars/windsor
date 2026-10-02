/**
 * The pieces every row of the Euclid card is built from (windsor#356): the
 * name column on the left and the strip of cells beside it, each cell at
 * the trigger cells' width, with the song's beat or bar gap where the
 * meter puts one. A row hands the card's loop its playhead
 * (`RowHead`), which lights one of its cells in `regionPlayhead.ts`'s two
 * strengths.
 */
import type { RegionStep } from '@windsor/engine';
import { el } from './dom';
import type { StepGroup } from './meterGrid';

/** What the loop lights on one row: its cells, and where its playhead is at a region step. */
export interface RowHead {
  readonly cells: HTMLElement;
  head(at: RegionStep | null): number;
}

/**
 * The ratchet and trigger rows' name column, set to the right against the
 * cells as the mockup draws it (windsor#393): any controls beside the
 * title, then the small line under them (none when `sub` is empty).
 */
export function rowName(title: string, sub: string, ...controls: HTMLElement[]): HTMLElement {
  const name = el('div', 'euclid-row-name');
  const line = el('div', 'euclid-row-title');
  line.append(...controls, el('b', '', title));
  name.appendChild(line);
  if (sub) name.appendChild(el('small', '', sub));
  return name;
}

/** A row: its class, its name column, its cells and anything after them. */
export function row(className: string, name: HTMLElement, ...rest: HTMLElement[]): HTMLElement {
  const node = el('div', `euclid-row ${className}`);
  node.append(name, ...rest);
  return node;
}

/**
 * `count` cells made by `make`, each marked with its index and the gap
 * `groupAt` puts before it: the song's beat or bar line, by the rule the
 * Grid and Chord strips share (`meterGrid.ts`, windsor#431).
 */
export function cellStrip(
  count: number,
  groupAt: (index: number) => StepGroup,
  make: (index: number) => HTMLElement,
): HTMLElement {
  const strip = el('div', 'euclid-cells');
  for (let i = 0; i < count; i++) {
    const cell = make(i);
    cell.dataset.cell = String(i);
    const group = groupAt(i);
    cell.classList.toggle('beat', group === 'beat');
    cell.classList.toggle('bar', group === 'bar');
    strip.appendChild(cell);
  }
  return strip;
}

/** A small button for a name column (− + ×, Release). */
export function nameButton(text: string, label: string, className: string): HTMLButtonElement {
  const button = el('button', className, text) as HTMLButtonElement;
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

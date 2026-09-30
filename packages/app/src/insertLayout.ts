/**
 * The layout inside an insert's page (windsor#173 decision 5; the mockup's
 * `.col`, `docs/research/2026-09-30-insert-rack/mockup.html`): a page is a
 * row of columns at the rack's height. Knobs stand in columns of two, spaced
 * evenly down the height; a picker, a switch or a note takes a wide column;
 * a plot or a meter takes a column of its own. `console.css` sizes them.
 */
import { el } from './dom';

/** One page's body: its columns, left to right. */
export function insertPage(...columns: readonly HTMLElement[]): HTMLElement {
  const page = el('div', 'insert-page');
  page.append(...columns);
  return page;
}

/** A column of knobs (two at most), or of one plot or meter. */
export function insertColumn(...children: readonly HTMLElement[]): HTMLElement {
  const column = el('div', 'insert-col');
  column.append(...children);
  return column;
}

/** A wide column: pickers, switches, buttons and notes, stacked. */
export function wideColumn(...children: readonly HTMLElement[]): HTMLElement {
  const column = el('div', 'insert-col wide');
  column.append(...children);
  return column;
}

/** A short note in a wide column: what a card's controls mean together. */
export const insertNote = (text: string): HTMLElement => el('div', 'insert-note', text);

/**
 * The layout inside an insert's page (windsor#173 decision 5; the mockup's
 * `.col`, `docs/research/2026-09-30-insert-rack/mockup.html`): a page is a
 * row of columns at the rack's height. Knobs stand in columns of two, spaced
 * evenly down the height; a picker, a switch or a note takes a wide column;
 * a plot or a meter takes a column of its own. `console.css` sizes them.
 */
import { el } from './dom';
import { KNOBS_PER_COLUMN } from './insertRackTables';

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

/** `knobs` in columns of two at the rack's small dial, in order. */
export function knobColumns(knobs: readonly HTMLElement[]): HTMLElement[] {
  const columns: HTMLElement[] = [];
  for (let at = 0; at < knobs.length; at += KNOBS_PER_COLUMN) {
    columns.push(insertColumn(...knobs.slice(at, at + KNOBS_PER_COLUMN)));
  }
  return columns;
}

/** A wide column: pickers, switches, buttons and notes, stacked. */
export function wideColumn(...children: readonly HTMLElement[]): HTMLElement {
  const column = el('div', 'insert-col wide');
  column.append(...children);
  return column;
}

/** A wide column that grows past the picker width for a switch's longer label. */
export function fitColumn(...children: readonly HTMLElement[]): HTMLElement {
  const column = wideColumn(...children);
  column.classList.add('fit');
  return column;
}

/**
 * A short note in a wide column: what a card's controls mean together. A
 * longer explanation goes in `title`, a tooltip, so it never crowds the
 * controls.
 */
export function insertNote(text: string, title = ''): HTMLElement {
  const note = el('div', 'insert-note', text);
  if (title) note.title = title;
  return note;
}

/** A thin vertical rule between two groups of columns on one page. */
export const insertRule = (): HTMLElement => el('div', 'insert-rule');

/**
 * A switch (the mockup's `.toggle`): a real checkbox, which the rack draws
 * as a small filled square, and its label beside it.
 */
export function insertSwitch(
  label: string,
  checked: boolean,
  change: (checked: boolean) => void,
): HTMLElement {
  const wrap = el('label', 'insert-switch');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.onchange = (): void => change(input.checked);
  wrap.append(input, el('span', '', label));
  return wrap;
}

/** A picker with its small label above it (the mockup's `.field`). */
export function insertSelect(o: {
  readonly label: string;
  readonly options: readonly (readonly [value: string, text: string])[];
  readonly value: string;
  change(value: string): void;
  /** What the picker is called to a screen reader, when not its label. */
  readonly ariaLabel?: string;
}): HTMLElement {
  const wrap = el('label', 'field-wrap', o.label);
  const select = document.createElement('select');
  select.className = 'field';
  select.setAttribute('aria-label', o.ariaLabel ?? o.label);
  for (const [value, text] of o.options) select.add(new Option(text, value));
  select.value = o.value;
  select.onchange = (): void => o.change(select.value);
  wrap.append(select);
  return wrap;
}

/**
 * The patch bar's search popover (windsor#521 decision 4; record
 * `2026-10-03-parts-tab-layout` decision 5, the second tier): a search field
 * with focus, the Category, Tag and Source selects in one row, the results
 * (the name, then `<category> · <source>`) and `<n> of <total>`. ↑ ↓ move the
 * highlight, Enter or a click loads, Esc or a click outside closes. It opens
 * from a click on the patch box or ⌘K / Ctrl+K while the Parts tab shows,
 * and hangs from the patch box, so it follows the box at any width or zoom.
 * The filter is `presetBrowser.ts`'s retained one; the search is an input,
 * so the computer keyboard plays no notes while it has focus.
 */
import type { PresetListing } from '@windsor/engine';
import { el } from './dom';
import { PATCH_SOURCE_LABELS } from './patchLibrary';
import { filteredListing, filterSelects, patchFilter } from './presetBrowser';
import { moveHighlight } from './patchStepModel';

export interface PopoverRequest {
  /** The `.patch-box-wrap` the popover hangs from; it holds the patch box. */
  readonly anchor: HTMLElement;
  readonly entries: readonly PresetListing[];
  /** The id the part plays: highlighted when the filter shows it. */
  readonly current: string;
  /** Load the chosen id; the popover has closed by then. */
  readonly load: (id: string) => void;
}

const isMac = (): boolean => /Mac|iP(hone|ad|od)/.test(navigator.platform);

function resultRow(entry: PresetListing): HTMLElement {
  const row = el('li', 'patch-pop-row');
  row.setAttribute('role', 'option');
  row.dataset.id = entry.id;
  row.append(
    el('span', 'patch-pop-name', entry.name),
    el('span', 'patch-pop-detail', `${entry.category} · ${PATCH_SOURCE_LABELS[entry.source]}`),
  );
  return row;
}

function searchField(): { box: HTMLElement; input: HTMLInputElement } {
  const box = el('div', 'patch-pop-search');
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'field';
  input.name = 'preset-search';
  input.placeholder = 'Search sounds or tags…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Search presets');
  input.value = patchFilter.query;
  box.append(input, el('span', 'patch-pop-key', isMac() ? '⌘K' : 'Ctrl K'));
  return { box, input };
}

/** Open the popover under the patch box; a second open while one shows closes it. */
// eslint-disable-next-line max-lines-per-function -- one popover: its parts, the list refresh and the keys, wired in order
export function togglePatchPopover(request: PopoverRequest): void {
  const { anchor, entries } = request;
  const open = anchor.querySelector('.patch-pop');
  if (open) return closePopover(anchor, true);
  const pop = el('div', 'patch-pop');
  const { box: search, input } = searchField();
  const list = el('ul', 'patch-pop-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Preset results');
  const foot = el('div', 'patch-pop-foot');
  const count = el('span');
  count.setAttribute('role', 'status');
  foot.append(count, el('span', '', '↑↓ move · ⏎ load · Esc closes'));
  let matches: PresetListing[] = [];
  let highlight = -1;
  const paint = (): void => {
    [...list.children].forEach((row, i) => row.classList.toggle('hl', i === highlight));
    list.children[highlight]?.scrollIntoView({ block: 'nearest' });
  };
  const refresh = (keep: string): void => {
    matches = filteredListing(entries);
    list.replaceChildren(...matches.map(resultRow));
    highlight = Math.max(
      0,
      matches.findIndex((entry) => entry.id === keep),
    );
    if (matches.length === 0) highlight = -1;
    count.textContent = `${matches.length} of ${entries.length}`;
    paint();
  };
  const choose = (index: number): void => {
    const id = matches[index]?.id;
    if (id === undefined) return;
    closePopover(anchor, false);
    request.load(id);
  };
  input.oninput = (): void => {
    patchFilter.query = input.value;
    refresh('');
  };
  input.onkeydown = (event): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      highlight = moveHighlight(highlight, matches.length, event.key === 'ArrowDown' ? 1 : -1);
      paint();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(highlight);
    }
  };
  // The list keeps focus in the search field: a press never lands on a row.
  list.onpointerdown = (event): void => event.preventDefault();
  list.onclick = (event): void => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.patch-pop-row');
    if (row) choose([...list.children].indexOf(row));
  };
  const selects = filterSelects(entries, () => {
    refresh(matches[highlight]?.id ?? '');
    input.focus();
  });
  pop.append(search, selects, list, foot);
  pop.onkeydown = (event): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closePopover(anchor, true);
    } else if (event.key === 'Tab') closePopover(anchor, false);
  };
  anchor.appendChild(pop);
  anchor.classList.add('open');
  refresh(request.current);
  const outside = (event: PointerEvent): void => {
    if (event.target instanceof Node && anchor.contains(event.target)) return;
    closePopover(anchor, false);
  };
  document.addEventListener('pointerdown', outside, true);
  dismissers.set(anchor, () => document.removeEventListener('pointerdown', outside, true));
  input.focus();
  input.select();
}

const dismissers = new WeakMap<HTMLElement, () => void>();

/** Close the popover; `refocus` hands focus back to the patch box so the keys play again. */
export function closePopover(anchor: HTMLElement, refocus: boolean): void {
  anchor.querySelector('.patch-pop')?.remove();
  anchor.classList.remove('open');
  dismissers.get(anchor)?.();
  dismissers.delete(anchor);
  if (refocus) anchor.querySelector<HTMLElement>('.patch-box')?.focus();
}

let searchKeyWired = false;

/**
 * ⌘K / Ctrl+K opens the popover while the Parts tab shows: one listener for
 * the page, which finds the bar's patch box at the press, so a re-render
 * never stacks a second one.
 */
export function wirePatchSearchKey(): void {
  if (searchKeyWired) return;
  searchKeyWired = true;
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
    if (event.altKey || event.shiftKey || document.querySelector('dialog:modal')) return;
    const box = document.getElementById('patchBox');
    if (!box || box.closest('[hidden]')) return;
    // Handled: the window's audition keyboard must not read the `k` as well.
    event.preventDefault();
    event.stopPropagation();
    if (!box.parentElement?.querySelector('.patch-pop')) box.click();
    else box.parentElement.querySelector<HTMLInputElement>('.patch-pop input')?.focus();
  });
}

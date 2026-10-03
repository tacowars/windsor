/**
 * The full-pane patch browser (windsor#522; record
 * `2026-10-03-parts-tab-layout` decision 5, the third tier, and the mockup's
 * layout B with its "Full browser" switch): ⤢ Browse patches in the bar, or
 * ⤢ Browse all in the search popover, opens it over the Parts tab's body
 * under the bar; ✕ Close, Esc or ⤢ again closes it. A header row (search,
 * the part it loads into, the library folder actions), the facets, the
 * results table and the info pane (`patchBrowserInfo.ts`). The rules are
 * `patchBrowserModel.ts`; the filter is `presetBrowser.ts`'s retained one,
 * so the popover and ◀ ▶ follow a choice made here.
 *
 * The pane is the next sibling of `#patchBar`, put there by `syncPatchBrowser`
 * each time the bar is built, so a pick, a part switch or a whole-tab render
 * finds it again while it is open.
 */
import type { PresetListing } from '@windsor/engine';
import { partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { libraryFolderEntries } from './libraryActions';
import type { PatchBarActions } from './patchBar';
import { browserInfo } from './patchBrowserInfo';
import { paneKeys } from './patchBrowserKeys';
import type { FacetField } from './patchBrowserModel';
import { browserRows, facets, keepSelection, pickFacet } from './patchBrowserModel';
import { ROW_SOURCE_LABELS } from './patchLibrary';
import { moveHighlight } from './patchStepModel';
import { loadPreset, patchFilter, presetListing } from './presetBrowser';

/** Open or not, and the selected row: kept across the pane's rebuilds. */
const state: { open: boolean; selected: string | null } = { open: false, selected: null };

const PANE_ID = 'patchBrowser';
const SEARCH_ID = 'patchBrowserSearch';
const RESULTS_ID = 'patchBrowserResults';
const BROWSE_ID = 'patchBrowse';

export const isPatchBrowserOpen = (): boolean => state.open;

/** Focus the results once the bar and the pane have been rebuilt, so the QWERTY keys play. */
const focusResults = (): void => queueMicrotask(() => document.getElementById(RESULTS_ID)?.focus());

/** Focus the browser's search field (the patch box and ⌘K while the browser is open). */
export function focusBrowserSearch(): void {
  const input = document.getElementById(SEARCH_ID) as HTMLInputElement | null;
  input?.focus();
  input?.select();
}

function syncBrowseButton(): void {
  document.getElementById(BROWSE_ID)?.setAttribute('aria-pressed', String(state.open));
}

/** Open the pane under the bar with focus in its search. */
export function openPatchBrowser(ctx: AppCtx, actions: PatchBarActions): void {
  state.open = true;
  state.selected = null;
  syncPatchBrowser(ctx, actions);
  focusBrowserSearch();
}

/** Close the pane; `refocus` hands focus to ⤢ Browse patches so the keys play again. */
export function closePatchBrowser(refocus: boolean): void {
  state.open = false;
  document.getElementById(PANE_ID)?.remove();
  syncBrowseButton();
  if (refocus) document.getElementById(BROWSE_ID)?.focus();
}

export function togglePatchBrowser(ctx: AppCtx, actions: PatchBarActions): void {
  if (state.open) closePatchBrowser(true);
  else openPatchBrowser(ctx, actions);
}

/** A facet's key, so a pick that redraws the column focuses the facet's new copy. */
const facetKey = (field: FacetField, value: string): string => `${field}:${value}`;

function facetRow(
  key: string,
  label: string,
  count: string,
  on: boolean,
  pick: () => void,
): HTMLElement {
  const row = el('button', 'pb-facet') as HTMLButtonElement;
  row.type = 'button';
  row.dataset.facet = key;
  row.setAttribute('aria-pressed', String(on));
  row.append(el('span', '', label), el('span', 'pb-count', count));
  row.onclick = pick;
  return row;
}

function facetSection(title: string): HTMLElement {
  const section = el('div', 'section');
  const head = el('div', 'section-title');
  head.appendChild(el('span', '', title));
  section.appendChild(head);
  return section;
}

/** The Source, Category and Tags facets; a pick sets the shared filter and refreshes. */
function facetColumn(entries: readonly PresetListing[], refresh: () => void): HTMLElement {
  const column = el('div', 'pb-facets');
  const shown = facets(entries, patchFilter);
  const pick =
    (field: FacetField, value: string, key = facetKey(field, value)) =>
    (): void => {
      patchFilter[field] = pickFacet(patchFilter, field, value);
      refresh();
      // The column was redrawn: the keyboard stays on the facet it pressed.
      document.querySelector<HTMLElement>(`.pb-facets [data-facet="${CSS.escape(key)}"]`)?.focus();
    };
  const source = facetSection('Source');
  for (const row of shown.source)
    source.appendChild(
      facetRow(
        facetKey('source', row.value),
        row.label,
        String(row.count),
        patchFilter.source === row.value,
        pick('source', row.value),
      ),
    );
  const category = facetSection('Category');
  for (const row of shown.category)
    category.appendChild(
      facetRow(
        facetKey('category', row.value),
        row.label,
        String(row.count),
        patchFilter.category === row.value,
        // All is never a toggle: it clears the category.
        row.value === ''
          ? pick('category', patchFilter.category, facetKey('category', ''))
          : pick('category', row.value),
      ),
    );
  const tags = facetSection('Tags');
  const chips = el('div', 'pb-tags');
  for (const tag of shown.tags) {
    const chip = el('button', 'pb-tag', tag) as HTMLButtonElement;
    chip.type = 'button';
    chip.dataset.facet = facetKey('tag', tag);
    chip.setAttribute('aria-pressed', String(patchFilter.tag === tag));
    chip.onclick = pick('tag', tag);
    chips.appendChild(chip);
  }
  tags.appendChild(chips);
  column.append(source, category, tags);
  return column;
}

function resultsTable(rows: readonly PresetListing[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'pb-table';
  const head = document.createElement('tr');
  for (const name of ['Name', 'Category', 'Tags', 'Source']) head.appendChild(el('th', '', name));
  table.createTHead().appendChild(head);
  const body = table.createTBody();
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;
    tr.append(
      el('td', '', row.name),
      el('td', '', row.category),
      el('td', '', row.tags.join(', ')),
      el('td', '', ROW_SOURCE_LABELS[row.source]),
    );
    body.appendChild(tr);
  }
  return table;
}

/** The pane's fixed parts, built once per open: the header, the three columns. */
function paneShell(): HTMLElement {
  const pane = el('div', 'patch-browser');
  pane.id = PANE_ID;
  pane.setAttribute('role', 'region');
  pane.setAttribute('aria-label', 'Patch browser');
  const head = el('div', 'pb-head');
  const search = document.createElement('input');
  search.type = 'search';
  search.id = SEARCH_ID;
  search.className = 'field pb-search';
  search.name = 'patch-browser-search';
  search.placeholder = 'Search sounds or tags…';
  search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Search patches');
  const results = el('div', 'pb-results');
  results.id = RESULTS_ID;
  results.tabIndex = 0;
  results.setAttribute('aria-label', 'Patches');
  head.append(
    el('span', 'pb-title', 'Patches'),
    el('span', 'pb-sep'),
    search,
    el('span', 'hint pb-hint'),
    el('span', 'pb-grow'),
    el('span', 'pb-folder'),
  );
  pane.append(head, el('div', 'pb-facets'), results, el('div', 'pb-info'));
  pane.addEventListener('keydown', (event) => paneKeys(pane, event));
  return pane;
}

/** The pane's moving parts over the listing now: the hint, the folder buttons, facets, table, info. */
// eslint-disable-next-line max-lines-per-function -- one refresh: each part of the pane redrawn in order, sharing the rows and the selection
function fill(pane: HTMLElement, ctx: AppCtx, actions: PatchBarActions): void {
  const refresh = (): void => fill(pane, ctx, actions);
  const entries = presetListing(ctx);
  const rows = browserRows(entries, patchFilter);
  const part = partAt(ctx.model.doc, ctx.parts.selected);
  state.selected = keepSelection(rows, state.selected, part?.preset ?? '');
  const search = pane.querySelector<HTMLInputElement>('.pb-search');
  if (search && search.value !== patchFilter.query) search.value = patchFilter.query;
  const hint = pane.querySelector('.pb-hint');
  hint?.replaceChildren('Loading into ', el('b', 'pb-part', part?.name ?? '—'));
  pane.querySelector('.pb-folder')?.replaceChildren(...folderButtons(ctx));
  pane.querySelector('.pb-facets')?.replaceWith(facetColumn(entries, refresh));
  const results = pane.querySelector<HTMLElement>('.pb-results');
  const table = resultsTable(rows);
  // A refresh keeps the table where it was scrolled; a fresh pane centres the selection.
  const fresh = !results?.firstChild;
  const top = results?.scrollTop ?? 0;
  results?.replaceChildren(table);
  if (results) results.scrollTop = top;
  const load = (id: string): void => loadPreset(ctx, id, actions, focusResults);
  const select = (id: string | null, scroll: ScrollLogicalPosition | null): void => {
    state.selected = id;
    for (const tr of table.tBodies[0]?.rows ?? []) {
      const on = tr.dataset.id === id;
      tr.classList.toggle('hl', on);
      tr.setAttribute('aria-selected', String(on));
      if (on && scroll) tr.scrollIntoView({ block: scroll });
    }
    const row = rows.find((entry) => entry.id === id);
    pane.querySelector('.pb-info')?.replaceWith(
      browserInfo(ctx, row ?? null, {
        load,
        done: (next) => {
          if (next !== undefined) state.selected = next;
          actions.refresh();
          focusResults();
        },
      }),
    );
  };
  table.onclick = (event): void => {
    const tr = (event.target as HTMLElement).closest<HTMLElement>('tr[data-id]');
    if (tr) select(tr.dataset.id ?? null, null);
  };
  table.ondblclick = (event): void => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('tr[data-id]')?.dataset.id;
    if (id) load(id);
  };
  const keys = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const at = rows.findIndex((row) => row.id === state.selected);
      const next = moveHighlight(at, rows.length, event.key === 'ArrowDown' ? 1 : -1);
      select(rows[next]?.id ?? null, 'nearest');
    } else if (event.key === 'Enter' && state.selected !== null) {
      event.preventDefault();
      load(state.selected);
    }
  };
  if (results) results.onkeydown = keys;
  if (search) {
    search.onkeydown = keys;
    search.oninput = (): void => {
      patchFilter.query = search.value;
      refresh();
    };
  }
  select(state.selected, fresh ? 'center' : 'nearest');
}

/** The library folder actions, as the bar's ⋯ menu offers them, as buttons. */
function folderButtons(ctx: AppCtx): HTMLElement[] {
  return libraryFolderEntries(ctx).flatMap((item) => {
    if (item.kind !== 'action') return [];
    const button = el('button', 'btn', item.label) as HTMLButtonElement;
    button.type = 'button';
    button.title = item.title;
    button.disabled = !item.enabled;
    button.onclick = (): void => void item.run(button);
    return [button];
  });
}

/**
 * Put the pane after the bar while it is open, else take it away; called
 * each time the bar is built. The pane is kept across a refresh, so the
 * search field keeps its focus and its caret.
 */
export function syncPatchBrowser(ctx: AppCtx, actions: PatchBarActions): void {
  wireEscape();
  syncBrowseButton();
  const bar = document.getElementById('patchBar');
  let pane = document.getElementById(PANE_ID);
  if (!state.open || !bar) return pane?.remove();
  if (!pane || pane.previousElementSibling !== bar) {
    pane?.remove();
    pane = paneShell();
    const close = el('button', 'btn', '✕ Close') as HTMLButtonElement;
    close.type = 'button';
    close.title = 'Close the browser (Esc)';
    close.onclick = (): void => closePatchBrowser(true);
    pane.querySelector('.pb-head')?.appendChild(close);
    bar.after(pane);
  }
  fill(pane, ctx, actions);
}

let escapeWired = false;

/** Esc closes the browser from anywhere on the Parts tab; a modal, the popover or the ⋯ menu takes it first. */
function wireEscape(): void {
  if (escapeWired) return;
  escapeWired = true;
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !state.open || event.defaultPrevented) return;
    const pane = document.getElementById(PANE_ID);
    if (!pane || pane.closest('[hidden]') || document.querySelector('dialog:modal')) return;
    event.preventDefault();
    closePatchBrowser(true);
  });
}

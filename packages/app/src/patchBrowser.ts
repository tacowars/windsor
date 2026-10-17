/**
 * The full-pane patch browser (windsor#522; record
 * `2026-10-03-parts-tab-layout` decision 5, the third tier, and the mockup's
 * layout B with its "Full browser" switch), the one browser for patches and
 * racks (windsor#884, record `2026-10-17-racks` decision 18, the approved
 * `docs/design/rack-browser-mockup.html`): ⤢ Browse patches in the bar, or
 * ⤢ Browse all in the search popover, opens it over the Parts tab's body
 * under the bar; ✕ Close, Esc or ⤢ again closes it. A header row (search,
 * the part it loads into, the library folder actions), the facets
 * (`patchBrowserFacets.ts`, Kind first), the results table
 * (`patchBrowserTable.ts`) and the info pane (`patchBrowserInfo.ts`, or
 * `rackBrowserInfo.ts` on Racks). The rules are `patchBrowserModel.ts` and
 * `rackBrowserModel.ts`; the filter is `presetBrowser.ts`'s retained one, so
 * the popover and ◀ ▶ follow a choice made here, the kind apart.
 *
 * The pane is the next sibling of `#patchBar`, put there by `syncPatchBrowser`
 * each time the bar is built, so a pick, a part switch or a whole-tab render
 * finds it again while it is open.
 */
import { partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { libraryFolderEntries } from './libraryActions';
import { library } from './libraryModel';
import type { PatchBarActions } from './patchBar';
import type { BrowserKind } from './presetBrowser';
import { facetColumn } from './patchBrowserFacets';
import { browserInfo } from './patchBrowserInfo';
import { paneKeys } from './patchBrowserKeys';
import { browserRows, keepSelection } from './patchBrowserModel';
import { rackTable, resultsTable } from './patchBrowserTable';
import { moveHighlight } from './patchStepModel';
import { loadPreset, patchFilter, presetListing } from './presetBrowser';
import { addPartFromRack, loadRackIntoPart } from './rackBrowserActions';
import { rackBrowserInfo } from './rackBrowserInfo';
import type { RackRow } from './rackBrowserModel';
import { kindCounts, rackListing } from './rackBrowserModel';

/**
 * Open or not, the selected row, and (windsor#885) whether Add part from
 * rack… is pending, so the next rack load adds the part, and whether the
 * next sync hands focus to the search: kept across the pane's rebuilds.
 */
const state: {
  open: boolean;
  selected: string | null;
  pendingAdd: boolean;
  focusSearch: boolean;
} = { open: false, selected: null, pendingAdd: false, focusSearch: false };

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

/**
 * Open the browser on `kind` from elsewhere (the Song tab's Load rack…, the
 * header's Add part from rack…, windsor#885): the Parts tab is shown and
 * rendered, whose bar builds the pane, with focus in its search. With
 * `addPart`, the next rack load adds a part rather than loading into the
 * selected one, and a Close adds nothing.
 */
export function requestBrowser(ctx: AppCtx, kind: BrowserKind, addPart = false): void {
  patchFilter.kind = kind;
  state.open = true;
  state.selected = null;
  state.pendingAdd = addPart;
  state.focusSearch = true;
  // A switch is a tab-bar click (`tabShell.ts`), which shows the tab and syncs its button.
  document.querySelector<HTMLButtonElement>('[data-tab="parts"]')?.click();
  ctx.render();
}

/** Close the pane; `refocus` hands focus to ⤢ Browse patches so the keys play again. */
export function closePatchBrowser(refocus: boolean): void {
  state.open = false;
  state.pendingAdd = false;
  document.getElementById(PANE_ID)?.remove();
  syncBrowseButton();
  if (refocus) document.getElementById(BROWSE_ID)?.focus();
}

export function togglePatchBrowser(ctx: AppCtx, actions: PatchBarActions): void {
  if (state.open) closePatchBrowser(true);
  else openPatchBrowser(ctx, actions);
}

/** The head's title and the results' name, by the kind shown (decision 18). */
const KIND_TITLES = { patches: 'Patches', racks: 'Racks' } as const;

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
  results.setAttribute('aria-label', KIND_TITLES[patchFilter.kind]);
  head.append(
    el('span', 'pb-title', KIND_TITLES[patchFilter.kind]),
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
  const racks = patchFilter.kind === 'racks';
  const patches = presetListing(ctx);
  const rackRows = rackListing(library.racks, library.userRackIds);
  const entries = racks ? rackRows : patches;
  const rows = browserRows(entries, patchFilter);
  const part = partAt(ctx.model.doc, ctx.parts.selected);
  const current = (racks ? part?.rackSource : part?.preset) ?? '';
  state.selected = keepSelection(rows, state.selected, current);
  const search = pane.querySelector<HTMLInputElement>('.pb-search');
  if (search && search.value !== patchFilter.query) search.value = patchFilter.query;
  const hint = pane.querySelector('.pb-hint');
  if (state.pendingAdd) hint?.replaceChildren('Adding a part from a rack');
  else hint?.replaceChildren('Loading into ', el('b', 'pb-part', part?.name ?? '—'));
  const title = KIND_TITLES[patchFilter.kind];
  pane.querySelector('.pb-title')?.replaceChildren(title);
  pane.querySelector('.pb-results')?.setAttribute('aria-label', title);
  pane.querySelector('.pb-folder')?.replaceChildren(...folderButtons(ctx));
  pane
    .querySelector('.pb-facets')
    ?.replaceWith(facetColumn(entries, kindCounts(patches, rackRows, patchFilter), refresh));
  const results = pane.querySelector<HTMLElement>('.pb-results');
  const table = racks ? rackTable(rows as RackRow[]) : resultsTable(rows);
  // A refresh keeps the table where it was scrolled; a fresh pane centres the selection.
  const fresh = !results?.firstChild;
  const top = results?.scrollTop ?? 0;
  results?.replaceChildren(table);
  if (results) results.scrollTop = top;
  const load = (id: string, opener?: HTMLElement): void => {
    if (!racks) return loadPreset(ctx, id, actions, focusResults);
    if (!state.pendingAdd) return loadRackIntoPart(ctx, id, actions, focusResults, opener);
    if (addPartFromRack(ctx, id, actions, focusResults)) state.pendingAdd = false;
  };
  const done = (next?: string): void => {
    if (next !== undefined) state.selected = next;
    actions.refresh();
    focusResults();
  };
  const select = (id: string | null, scroll: ScrollLogicalPosition | null): void => {
    state.selected = id;
    for (const tr of table.tBodies[0]?.rows ?? []) {
      const on = tr.dataset.id === id;
      tr.classList.toggle('hl', on);
      tr.setAttribute('aria-selected', String(on));
      if (on && scroll) tr.scrollIntoView({ block: scroll });
    }
    const row = rows.find((entry) => entry.id === id) ?? null;
    pane
      .querySelector('.pb-info')
      ?.replaceWith(
        racks
          ? rackBrowserInfo(ctx, row as RackRow | null, { load, done })
          : browserInfo(ctx, row, { load, done }),
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
  if (state.focusSearch) {
    state.focusSearch = false;
    focusBrowserSearch();
  }
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

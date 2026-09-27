/** Native keyboard-accessible browsing; filtering never changes the song. */
import {
  clonePatch,
  filterPresets,
  partAt,
} from '../../../packages/client/src/audio/index-for-editor';
import type {
  PresetFilter,
  PresetListing,
} from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el, select } from './dom';
import { library, libraryPatch, listLibrary } from './libraryModel';

// Retain filters when a patch selection rebuilds the Parts rail, or when changing parts.
const filter: PresetFilter = { query: '', category: '', tag: '', source: '' };

/** Copy on selection: the exported song owns the sound even before its first knob edit. */
export function choosePreset(ctx: AppCtx, slot: number, name: string): boolean {
  const existing = ctx.model.doc.patches;
  const documentPatch = existing && Object.hasOwn(existing, name) ? existing[name] : undefined;
  const patch = documentPatch ?? libraryPatch(library, name);
  if (!patch) return false;
  return ctx.change({
    ...partChange(slot, { preset: name }),
    patches: { [name]: clonePatch(patch) },
  }).ok;
}

function filterControls(entries: PresetListing[], refresh: () => void): HTMLElement {
  const box = el('div', 'preset-filters');
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'field';
  search.placeholder = 'Search sounds or tags…';
  search.setAttribute('aria-label', 'Search presets');
  search.value = filter.query;
  search.oninput = (): void => {
    filter.query = search.value;
    refresh();
  };
  box.appendChild(search);
  for (const field of ['category', 'tag', 'source'] as const) {
    const values = [
      ...new Set(entries.flatMap((entry) => (field === 'tag' ? entry.tags : [entry[field]]))),
    ].sort();
    // Keep an active filter visible after an import/revert removes its last entry.
    if (filter[field] && !values.includes(filter[field])) values.push(filter[field]);
    box.appendChild(
      select(
        `Preset ${field}`,
        [
          { value: '', label: field === 'category' ? 'All musical sounds' : `All ${field}s` },
          ...values.map((value) => ({ value, label: value })),
        ],
        filter[field],
        (value) => {
          filter[field] = value;
          refresh();
        },
      ),
    );
  }
  return box;
}

/** Runs before a load lands: the unsaved-changes guard (#563) calls `proceed` or drops the pick. */
export type PickGuard = (proceed: () => void) => void;

// eslint-disable-next-line max-lines-per-function -- one browser: the list, its filters and the load path, wired in order
export function presetBrowser(
  ctx: AppCtx,
  slot: number,
  onPick: () => void,
  guard: PickGuard = (proceed) => proceed(),
): HTMLElement {
  const box = el('div', 'preset-browser');
  const entries = listLibrary(library.entries, ctx.model.doc.patches);
  const selected = partAt(ctx.model.doc, slot)?.preset ?? '';
  const current = el('p', 'hint');
  current.textContent = `Current: ${entries.find((entry) => entry.id === selected)?.name ?? selected}`;
  const results = document.createElement('select');
  results.className = 'field preset-results';
  results.size = 7;
  results.setAttribute('aria-label', 'Preset results');
  const count = el('p', 'hint');
  count.setAttribute('role', 'status');
  const description = el('p', 'hint');
  const load = el('button', 'btn', 'Load patch') as HTMLButtonElement;
  load.type = 'button';
  const describe = (): void => {
    const entry = entries.find((candidate) => candidate.id === results.value);
    description.textContent = entry ? `${entry.tags.join(' · ')} — ${entry.description}` : '';
    load.disabled = !entry;
  };
  const refresh = (): void => {
    const previous = results.value || selected;
    const matches = filterPresets(entries, filter);
    results.replaceChildren(
      ...matches.map((entry) => new Option(`${entry.name} · ${entry.source}`, entry.id)),
    );
    results.value = matches.some((entry) => entry.id === previous)
      ? previous
      : (matches[0]?.id ?? '');
    count.textContent = matches.length
      ? `${matches.length} patches`
      : 'No matches. Clear a filter or change your search.';
    results.disabled = matches.length === 0;
    describe();
  };
  load.setAttribute('aria-label', 'Load patch');
  // onPick rebuilds the rail, so focus is restored by label onto the new elements. A
  // keyboard load stays in the list to keep browsing; a mouse load lands on the button,
  // where the QWERTY keys play the new sound (they are ignored inside a select).
  const apply = (focusLabel: string): void => {
    guard(() => {
      if (choosePreset(ctx, slot, results.value)) {
        onPick();
        document.querySelector<HTMLElement>(`[aria-label="${focusLabel}"]`)?.focus();
      }
    });
  };
  results.onchange = describe;
  results.ondblclick = (): void => apply('Load patch');
  results.onkeydown = (event): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      apply('Preset results');
    }
  };
  load.onclick = (): void => apply('Load patch');
  box.append(current, filterControls(entries, refresh), count, results, description, load);
  refresh();
  return box;
}

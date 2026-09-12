/** Native keyboard-accessible browsing; filtering never changes the song. */
import {
  clonePatch,
  filterPresets,
  listPresets,
} from '../../../packages/client/src/audio/index-for-editor';
import { PRESETS } from '../../../packages/client/src/audio/index-for-editor';
import type {
  MusicPartId,
  PresetFilter,
  PresetListing,
} from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { el, select } from './dom';

// Retain filters when a patch selection rebuilds the Parts rail, or when changing parts.
const filter: PresetFilter = { query: '', category: '', tag: '', source: '' };

/** Copy on selection: the exported song owns the sound even before its first knob edit. */
export function choosePreset(ctx: AppCtx, id: MusicPartId, name: string): boolean {
  const existing = ctx.model.doc.patches;
  const documentPatch = existing && Object.hasOwn(existing, name) ? existing[name] : undefined;
  const patch = documentPatch ?? (Object.hasOwn(PRESETS, name) ? PRESETS[name] : undefined);
  if (!patch) return false;
  return ctx.change({ [id]: { preset: name }, patches: { [name]: clonePatch(patch) } }).ok;
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

export function presetBrowser(ctx: AppCtx, id: MusicPartId, onPick: () => void): HTMLElement {
  const box = el('div', 'preset-browser');
  const entries = listPresets(ctx.model.doc.patches);
  const selected = ctx.model.doc[id]?.preset ?? '';
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
  const apply = (): void => {
    if (choosePreset(ctx, id, results.value)) {
      onPick();
      document.querySelector<HTMLElement>('[aria-label="Preset results"]')?.focus();
    }
  };
  results.onchange = describe;
  results.ondblclick = apply;
  results.onkeydown = (event): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      apply();
    }
  };
  load.onclick = apply;
  box.append(current, filterControls(entries, refresh), count, results, description, load);
  refresh();
  return box;
}

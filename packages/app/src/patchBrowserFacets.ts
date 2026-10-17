/**
 * The full-pane browser's facets column (windsor#522; the Kind facet,
 * windsor#884, record `2026-10-17-racks` decision 18): Kind first, Patches |
 * Racks, then Source, Category and Tags over the kind shown. A pick sets the
 * shared filter (`presetBrowser.ts`'s `patchFilter`) and refreshes; the
 * column is redrawn, so the keyboard stays on the facet it pressed.
 */
import type { PresetListing } from '@windsor/engine';
import { el } from './dom';
import type { FacetField } from './patchBrowserModel';
import { facets, pickFacet } from './patchBrowserModel';
import type { BrowserKind } from './presetBrowser';
import { patchFilter } from './presetBrowser';

/** The Kind facet's rows, in the mockup's order. */
const KIND_ROWS: readonly { readonly value: BrowserKind; readonly label: string }[] = [
  { value: 'patches', label: 'Patches' },
  { value: 'racks', label: 'Racks' },
];

/** A facet's key, so a pick that redraws the column focuses the facet's new copy. */
const facetKey = (field: FacetField | 'kind', value: string): string => `${field}:${value}`;

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

/** After a pick redrew the column: the keyboard stays on the facet it pressed. */
const refocus = (key: string): void =>
  document.querySelector<HTMLElement>(`.pb-facets [data-facet="${CSS.escape(key)}"]`)?.focus();

/** The Kind, Source, Category and Tags facets over `entries`, the kind shown; `counts` is each kind's. */
// eslint-disable-next-line max-lines-per-function -- one column: its four sections drawn in order over the one filter
export function facetColumn(
  entries: readonly PresetListing[],
  counts: Record<BrowserKind, number>,
  refresh: () => void,
): HTMLElement {
  const column = el('div', 'pb-facets');
  const shown = facets(entries, patchFilter);
  const pick =
    (field: FacetField, value: string, key = facetKey(field, value)) =>
    (): void => {
      patchFilter[field] = pickFacet(patchFilter, field, value);
      refresh();
      refocus(key);
    };
  const kind = facetSection('Kind');
  for (const row of KIND_ROWS)
    kind.appendChild(
      facetRow(
        facetKey('kind', row.value),
        row.label,
        String(counts[row.value]),
        patchFilter.kind === row.value,
        () => {
          patchFilter.kind = row.value;
          refresh();
          refocus(facetKey('kind', row.value));
        },
      ),
    );
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
  column.append(kind, source, category, tags);
  return column;
}

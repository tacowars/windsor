/**
 * The full-pane patch browser's rules (windsor#522; record
 * `2026-10-03-parts-tab-layout` decision 5, the third tier), without the DOM:
 * the facets and their counts, the tag order, the rows the table shows, what
 * Rename and Delete act on for a row, and the info pane's fields. The filter
 * is `presetBrowser.ts`'s retained `patchFilter`, shared with the popover and
 * ◀ ▶, so every function here takes it as a value.
 */
import type { Envelope, Patch, PresetFilter, PresetListing } from '@windsor/engine';
import { ALGORITHMS, FILTER_MODE_NAMES, filterPresets } from '@windsor/engine';
import { ROW_SOURCE_LABELS } from './patchLibrary';

/** One facet row: the value it sets, its label and how many rows picking it would show. */
export interface FacetRow {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

/** The facets column: Source and Category with counts, then the tags, most used first. */
export interface Facets {
  readonly source: readonly FacetRow[];
  readonly category: readonly FacetRow[];
  readonly tags: readonly string[];
}

/** The Source facet's rows, in the issue's order. */
const SOURCE_ORDER: readonly PresetListing['source'][] = ['document', 'built-in', 'library'];

/** The facet a row sets; the search is the field's own. */
export type FacetField = 'source' | 'category' | 'tag';

/** How many rows the table would show with `field` set to `value`, the other facets and the search kept. */
const countWith = (
  entries: readonly PresetListing[],
  filter: PresetFilter,
  field: FacetField,
  value: string,
): number => filterPresets(entries, { ...filter, [field]: value }).length;

/** Each distinct value by how many entries carry it, most first, then by name. */
function byUse(values: readonly string[]): string[] {
  const uses = new Map<string, number>();
  for (const value of values) uses.set(value, (uses.get(value) ?? 0) + 1);
  return [...uses.keys()].sort(
    (a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0) || a.localeCompare(b),
  );
}

/** The tags, most used across the whole listing first, so the chips never jump as the filter moves. */
export const tagOrder = (entries: readonly PresetListing[]): string[] =>
  byUse(entries.flatMap((entry) => entry.tags));

/** `values` plus `active` when an import or a delete removed its last entry, so a choice stays visible. */
const keepActive = (values: string[], active: string): string[] =>
  active && !values.includes(active) ? [...values, active] : values;

/**
 * The facets for `entries` under `filter`. A count is the rows the table
 * would show on picking that row — the other facets and the search kept —
 * so it never promises rows the table then hides. Categories run by size
 * across the listing, as the tags do.
 */
export function facets(entries: readonly PresetListing[], filter: PresetFilter): Facets {
  const categories = keepActive(byUse(entries.map((entry) => entry.category)), filter.category);
  return {
    source: SOURCE_ORDER.map((value) => ({
      value,
      label: ROW_SOURCE_LABELS[value],
      count: countWith(entries, filter, 'source', value),
    })),
    category: [
      { value: '', label: 'All', count: countWith(entries, filter, 'category', '') },
      ...categories.map((value) => ({
        value,
        label: value,
        count: countWith(entries, filter, 'category', value),
      })),
    ],
    tags: keepActive(tagOrder(entries), filter.tag),
  };
}

/** A facet pick: a single choice, and picking the chosen row again clears it. */
export const pickFacet = (filter: PresetFilter, field: FacetField, value: string): string =>
  filter[field] === value ? '' : value;

/** The table's rows: the listing under the filter, by name. */
export const browserRows = (
  entries: readonly PresetListing[],
  filter: PresetFilter,
): PresetListing[] => filterPresets(entries, filter).sort((a, b) => a.name.localeCompare(b.name));

/**
 * The row to select after the rows change: the one selected if it is still
 * shown, else the part's own patch, else the first; null when nothing shows.
 */
export function keepSelection(
  rows: readonly PresetListing[],
  selected: string | null,
  current: string,
): string | null {
  const shown = (id: string | null): boolean => rows.some((row) => row.id === id);
  if (shown(selected)) return selected;
  if (shown(current)) return current;
  return rows[0]?.id ?? null;
}

/** What a row's patch is, for Rename and Delete. */
export interface RowFacts {
  /** The song holds a copy under the row's id. */
  readonly inSong: boolean;
  /** The library may write over (and delete) the row's id: a user patch, or any folder file. */
  readonly writable: boolean;
  /** A part of the song plays the row's id. */
  readonly played: boolean;
  /** Why the id can never be deleted (the engine's fallback), or null. */
  readonly refusal: string | null;
}

/** Where an action lands: the song's copy or the library file. */
export type ActionTarget = 'song' | 'library';

/**
 * Rename and Delete for a row, generalising the ⋯ menu's, which act on the
 * part's own patch. Rename renames the song's copy when there is one (as the
 * menu's does), else a library patch. Delete removes the library file when
 * the library may (as the menu's does; the song keeps its copy), else the
 * song's copy that no part plays. A built-in is neither: null disables both.
 */
export function rowActions(facts: RowFacts): {
  rename: ActionTarget | null;
  remove: ActionTarget | null;
} {
  let rename: ActionTarget | null = null;
  if (facts.inSong) rename = 'song';
  else if (facts.writable) rename = 'library';
  let remove: ActionTarget | null = null;
  if (facts.writable && facts.refusal === null) remove = 'library';
  else if (facts.inSong && !facts.played) remove = 'song';
  return { rename, remove };
}

/** The info pane's text for the selected row, and the envelope its sketch draws. */
export interface PatchInfo {
  readonly name: string;
  /** `<category> · <source>`, as the popover's rows read. */
  readonly detail: string;
  readonly tags: readonly string[];
  readonly description: string;
  /** `Algorithm 05 · 2 carriers · Filter LP · Drive off`. */
  readonly summary: string;
  /** The first carrier's envelope; null for an algorithm the engine lacks. */
  readonly envelope: Envelope | null;
}

const ALG_DIGITS = 2;

/** The info fields for `row`, whose patch is `patch` (the song's copy, else the library's). */
export function patchInfo(row: PresetListing, patch: Patch): PatchInfo {
  const alg = ALGORITHMS[patch.algorithm];
  const carriers = alg?.carriers.length ?? 0;
  const first = alg?.carriers[0];
  const summary = [
    `Algorithm ${String(patch.algorithm + 1).padStart(ALG_DIGITS, '0')}`,
    `${carriers} carrier${carriers === 1 ? '' : 's'}`,
    `Filter ${FILTER_MODE_NAMES[patch.filter.mode] ?? patch.filter.mode}`,
    `Drive ${patch.drive.on ? 'on' : 'off'}`,
  ].join(' · ');
  return {
    name: row.name,
    detail: `${row.category} · ${ROW_SOURCE_LABELS[row.source]}`,
    tags: row.tags,
    description: row.description,
    summary,
    envelope: first === undefined ? null : (patch.ops[first]?.env ?? null),
  };
}

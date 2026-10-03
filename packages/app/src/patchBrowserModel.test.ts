/**
 * The patch browser's rules (windsor#522): facet counts, the tag order, the
 * rows under the search and each facet, Rename and Delete per row, and the
 * info pane's fields for a built-in and for a song patch.
 */
import { describe, expect, it } from 'vitest';
import type { PresetFilter, PresetListing } from '@windsor/engine';
import { ALGORITHMS, HIDDEN_CATEGORY, makePatch } from '@windsor/engine';
import {
  browserRows,
  facets,
  keepSelection,
  patchInfo,
  pickFacet,
  rowActions,
  tagOrder,
} from './patchBrowserModel';

const row = (
  id: string,
  source: PresetListing['source'],
  category: string,
  tags: string[],
): PresetListing => ({ id, name: id, source, category, tags, description: `${id} sound` });

/** A song with two patches of its own beside four built-ins, one of them hidden, and a library patch. */
const LISTING: PresetListing[] = [
  row('Organ', 'document', 'Pads', ['warm', 'long']),
  row('Reactor', 'document', 'Basses', ['mono', 'dark']),
  row('Droplet', 'built-in', 'Plucks', ['bell', 'soft']),
  row('Pebble', 'built-in', 'Plucks', ['short', 'soft']),
  row('Carbon', 'built-in', 'Basses', ['mono', 'dark', 'soft']),
  row('Klaxon', 'built-in', HIDDEN_CATEGORY, ['noise']),
  row('Mine', 'library', 'Pads', ['warm']),
];

const ALL: PresetFilter = { query: '', category: '', tag: '', source: '' };

const counts = (list: readonly { value: string; count: number }[]): Record<string, number> =>
  Object.fromEntries(list.map((entry) => [entry.value, entry.count]));

describe('the facets', () => {
  it('count the song, the built-ins and the library, and each category, the hidden one apart from All', () => {
    const shown = facets(LISTING, ALL);
    expect(shown.source.map((entry) => entry.label)).toEqual(['This song', 'Built-in', 'Library']);
    expect(counts(shown.source)).toEqual({ document: 2, 'built-in': 3, library: 1 });
    expect(counts(shown.category)).toEqual({
      '': 6,
      Basses: 2,
      Pads: 2,
      Plucks: 2,
      [HIDDEN_CATEGORY]: 1,
    });
  });

  it('count what picking a row would show, under the other facets and the search', () => {
    const shown = facets(LISTING, { ...ALL, source: 'built-in', query: 'soft' });
    expect(counts(shown.category)).toMatchObject({ '': 3, Plucks: 2, Basses: 1, Pads: 0 });
    expect(counts(shown.source)).toEqual({ document: 0, 'built-in': 3, library: 0 });
  });

  it('order the tags by use across the listing, then by name, and keep a chosen one that has gone', () => {
    expect(tagOrder(LISTING)).toEqual([
      'soft',
      'dark',
      'mono',
      'warm',
      'bell',
      'long',
      'noise',
      'short',
    ]);
    expect(facets(LISTING, { ...ALL, tag: 'gone' }).tags.at(-1)).toBe('gone');
  });

  it('are single choices: picking the chosen row again clears it', () => {
    expect(pickFacet({ ...ALL, tag: 'mono' }, 'tag', 'mono')).toBe('');
    expect(pickFacet({ ...ALL, tag: 'mono' }, 'tag', 'dark')).toBe('dark');
  });
});

describe('the rows', () => {
  const ids = (filter: PresetFilter): string[] =>
    browserRows(LISTING, filter).map((entry) => entry.id);

  it('sort by name and follow the search and each facet', () => {
    expect(ids(ALL)).toEqual(['Carbon', 'Droplet', 'Mine', 'Organ', 'Pebble', 'Reactor']);
    expect(ids({ ...ALL, query: 'dark' })).toEqual(['Carbon', 'Reactor']);
    expect(ids({ ...ALL, source: 'document' })).toEqual(['Organ', 'Reactor']);
    expect(ids({ ...ALL, category: HIDDEN_CATEGORY })).toEqual(['Klaxon']);
    expect(ids({ ...ALL, tag: 'soft', category: 'Plucks' })).toEqual(['Droplet', 'Pebble']);
  });

  it('keep the selection while it shows, else the part’s patch, else the first', () => {
    const rows = browserRows(LISTING, { ...ALL, source: 'document' });
    expect(keepSelection(rows, 'Reactor', 'Organ')).toBe('Reactor');
    expect(keepSelection(rows, 'Droplet', 'Reactor')).toBe('Reactor');
    expect(keepSelection(rows, 'Droplet', 'Mine')).toBe('Organ');
    expect(keepSelection([], 'Droplet', 'Organ')).toBeNull();
  });
});

describe('Rename and Delete', () => {
  const facts = { inSong: false, writable: false, played: false, refusal: null };

  it('are off for a built-in', () => {
    expect(rowActions(facts)).toEqual({ rename: null, remove: null });
  });

  it('act on a library patch’s file', () => {
    expect(rowActions({ ...facts, writable: true })).toEqual({
      rename: 'library',
      remove: 'library',
    });
  });

  it('rename the song’s copy, and delete the library file before the copy, as the ⋯ menu does', () => {
    expect(rowActions({ ...facts, inSong: true, writable: true, played: true })).toEqual({
      rename: 'song',
      remove: 'library',
    });
  });

  it('delete a song’s own patch only while no part plays it', () => {
    expect(rowActions({ ...facts, inSong: true }).remove).toBe('song');
    expect(rowActions({ ...facts, inSong: true, played: true }).remove).toBeNull();
    expect(rowActions({ ...facts, writable: true, refusal: 'fallback' }).remove).toBeNull();
  });
});

describe('the info pane', () => {
  it('reads a built-in: category and source, algorithm, carriers, filter, drive and the first carrier’s envelope', () => {
    const patch = makePatch({ algorithm: 4, filter: { mode: 1 }, drive: { on: false } });
    const info = patchInfo(LISTING[2]!, patch);
    const first = ALGORITHMS[4]!.carriers[0]!;
    expect(info).toMatchObject({
      name: 'Droplet',
      detail: 'Plucks · Built-in',
      tags: ['bell', 'soft'],
      description: 'Droplet sound',
      summary: `Algorithm 05 · ${ALGORITHMS[4]!.carriers.length} carriers · Filter LP · Drive off`,
    });
    expect(info.envelope).toEqual(patch.ops[first]!.env);
  });

  it('reads a song patch as this song’s, with one carrier in the singular', () => {
    const one = ALGORITHMS.findIndex((alg) => alg.carriers.length === 1);
    const info = patchInfo(LISTING[0]!, makePatch({ algorithm: one, drive: { on: true } }));
    expect(info.detail).toBe('Pads · This song');
    expect(info.summary).toMatch(/· 1 carrier · Filter \w+ · Drive on$/);
  });
});

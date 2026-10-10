import { beforeAll, describe, expect, it } from 'vitest';
import type { Patch } from '@windsor/engine';
import { filterPresets, makePatch } from '@windsor/engine';
import { library, loadPageLibrary } from './libraryModel';
import { moveHighlight, stepListing, stepPartPatch, stepPatch } from './patchStepModel';

beforeAll(() => loadPageLibrary(library));

const PLUCKS = { query: '', category: 'Plucks', tag: '', source: '' };
const plucks = (patches: Record<string, Patch> = {}): string[] =>
  filterPresets(stepListing(library.entries, patches), PLUCKS).map((entry) => entry.id);

describe('◀ ▶ over the filtered order', () => {
  it('steps through the filter’s order and wraps at both ends', () => {
    const order = plucks();
    expect(order.length).toBeGreaterThan(2);
    const first = order[0]!;
    const last = order[order.length - 1]!;
    expect(stepPatch(order, first, 1)).toBe(order[1]);
    expect(stepPatch(order, order[1]!, -1)).toBe(first);
    expect(stepPatch(order, last, 1)).toBe(first);
    expect(stepPatch(order, first, -1)).toBe(last);
  });

  it('keeps its order when a step copies the patch it loads into the song', () => {
    const order = plucks();
    const picked = order[1]!;
    const song = { [picked]: library.entries[picked]!.patch, 'song-own': makePatch({}) };
    expect(plucks(song)).toEqual(order);
    const own = stepListing(library.entries, song).find((entry) => entry.id === 'song-own');
    expect(own?.source).toBe('document');
    const copy = stepListing(library.entries, song).find((entry) => entry.id === picked);
    expect(copy?.source).toBe('document');
  });

  it('enters a filter that hides the current patch at its first or last entry', () => {
    const order = ['a', 'b', 'c'];
    expect(stepPatch(order, '(init:lead)', 1)).toBe('a');
    expect(stepPatch(order, '(init:lead)', -1)).toBe('c');
  });

  it('walks on from a pick its filter now hides, in the full listing’s order', () => {
    const builtIn = { query: '', category: 'Plucks', tag: '', source: 'built-in' };
    const all = stepListing(library.entries).map((entry) => entry.id);
    const before = filterPresets(stepListing(library.entries), builtIn).map((entry) => entry.id);
    const picked = before[1]!;
    const song = { [picked]: library.entries[picked]!.patch };
    const after = filterPresets(stepListing(library.entries, song), builtIn).map((e) => e.id);
    expect(after).not.toContain(picked);
    expect(stepPatch(after, picked, 1, all)).toBe(before[2]);
    expect(stepPatch(after, picked, -1, all)).toBe(before[0]);
  });

  it('with one entry, loads it only when it is not already playing', () => {
    expect(stepPatch(['a'], 'a', 1)).toBeNull();
    expect(stepPatch(['a'], 'a', -1)).toBeNull();
    expect(stepPatch(['a'], 'z', 1)).toBe('a');
  });

  it('with none, loads nothing', () => {
    expect(stepPatch([], 'a', 1)).toBeNull();
    expect(stepPatch([], 'a', -1)).toBeNull();
  });
});

describe('a song’s copy of a library patch', () => {
  const song = (): Record<string, Patch> => ({
    kick: { ...library.entries.kick!.patch, name: 'Song Kick' },
  });

  it('lists once, with the song’s name, as this song’s', () => {
    const rows = stepListing(library.entries, song()).filter((entry) => entry.id === 'kick');
    expect(rows).toEqual([expect.objectContaining({ name: 'Song Kick', source: 'document' })]);
  });

  it('shows under the “this song” source filter', () => {
    const filter = { query: '', category: '', tag: '', source: 'document' };
    const ids = filterPresets(stepListing(library.entries, song()), filter).map((e) => e.id);
    expect(ids).toEqual(['kick']);
  });
});

describe('a part on its own copy of a library patch (windsor#669)', () => {
  const THIS_SONG = { query: '', category: '', tag: '', source: 'document' };
  const song = (): Record<string, Patch> => ({
    kick: library.entries.kick!.patch,
    'efm-bell-perc-2': { ...library.entries['efm-bell-perc']!.patch, name: 'Bell 2' },
  });
  const step = (by: 1 | -1): string | null => {
    const listing = stepListing(library.entries, song());
    return stepPartPatch({
      order: filterPresets(listing, THIS_SONG).map((entry) => entry.id),
      all: listing.map((entry) => entry.id),
      preset: 'efm-bell-perc-2',
      patchSource: 'efm-bell-perc',
      by,
    });
  };

  it('steps away from the copy it plays under “this song”, both ways', () => {
    expect(step(1)).toBe('kick');
    expect(step(-1)).toBe('kick');
  });

  it('steps from the library place when the filter hides the copy', () => {
    const all = ['a', 'bell', 'c', 'bell-2'];
    const at = { order: ['a', 'c'], all, preset: 'bell-2', patchSource: 'bell' };
    expect(stepPartPatch({ ...at, by: 1 })).toBe('c');
    expect(stepPartPatch({ ...at, by: -1 })).toBe('a');
  });
});

describe('the popover highlight', () => {
  it('moves by one and stops at both ends', () => {
    expect(moveHighlight(0, 3, 1)).toBe(1);
    expect(moveHighlight(2, 3, 1)).toBe(2);
    expect(moveHighlight(0, 3, -1)).toBe(0);
    expect(moveHighlight(0, 0, 1)).toBe(-1);
  });
});

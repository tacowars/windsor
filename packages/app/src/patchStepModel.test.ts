import { beforeAll, describe, expect, it } from 'vitest';
import type { Patch } from '@windsor/engine';
import { filterPresets, makePatch } from '@windsor/engine';
import { library, loadPageLibrary } from './libraryModel';
import { moveHighlight, stepListing, stepPatch } from './patchStepModel';

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
  });

  it('enters a filter that hides the current patch at its first or last entry', () => {
    const order = ['a', 'b', 'c'];
    expect(stepPatch(order, '(init:lead)', 1)).toBe('a');
    expect(stepPatch(order, '(init:lead)', -1)).toBe('c');
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

describe('the popover highlight', () => {
  it('moves by one and stops at both ends', () => {
    expect(moveHighlight(0, 3, 1)).toBe(1);
    expect(moveHighlight(2, 3, 1)).toBe(2);
    expect(moveHighlight(0, 3, -1)).toBe(0);
    expect(moveHighlight(0, 0, 1)).toBe(-1);
  });
});

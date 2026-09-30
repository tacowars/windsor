/**
 * The insert rack's view state (windsor#173 decision 4): the page shown and
 * the fold, per chain and position, kept across renders and moved with an
 * insert when the chain changes.
 */
import { describe, expect, it } from 'vitest';

import {
  OPEN_VIEW,
  afterAdd,
  afterMove,
  afterRemove,
  emptyRack,
  emptySeen,
  recordKinds,
  resetChain,
  showPage,
  syncChain,
  toggleFold,
  viewAt,
} from './insertRackModel';
import type { RackSeen, RackView } from './insertRackModel';

/** A card's three pages, by name. */
const P = ['One', 'Two', 'Three'] as const;

describe('viewAt', () => {
  it('starts every insert on page 1, open', () => {
    expect(viewAt(emptyRack(), 3, 0, P)).toEqual(OPEN_VIEW);
    expect(viewAt(emptyRack(), 'master', 4, ['Only'])).toEqual(OPEN_VIEW);
  });

  it('shows the first page once the card no longer has the page kept', () => {
    const state = showPage(emptyRack(), 1, 0, P, 2);
    expect(viewAt(state, 1, 0, P).page).toBe(2);
    expect(viewAt(state, 1, 0, ['One']).page).toBe(0);
    expect(viewAt(state, 1, 0, []).page).toBe(0);
  });

  it('keeps a page by name when the pages around it change (windsor#174 decision 3)', () => {
    const multiband = ['Main', 'Stage 1', 'Stage 2', 'Stage 3', 'Mod'];
    const single = ['Main', 'Stage 1', 'Mod'];
    const onMod = showPage(emptyRack(), 1, 0, multiband, 4);
    expect(viewAt(onMod, 1, 0, single).page).toBe(2);
    const onStage3 = showPage(emptyRack(), 1, 0, multiband, 3);
    expect(viewAt(onStage3, 1, 0, single).page).toBe(0);
    expect(viewAt(onStage3, 1, 0, multiband).page).toBe(3);
  });
});

describe('showPage and toggleFold', () => {
  it('set one insert and leave the others, and the argument, alone', () => {
    const start = emptyRack();
    const paged = showPage(start, 1, 2, P, 1);
    const folded = toggleFold(paged, 1, 0);
    expect(viewAt(folded, 1, 2, P)).toEqual({ page: 1, folded: false });
    expect(viewAt(folded, 1, 0, P)).toEqual({ page: 0, folded: true });
    expect(viewAt(folded, 1, 1, P)).toEqual(OPEN_VIEW);
    expect(start.size).toBe(0);
    expect(viewAt(paged, 1, 0, P)).toEqual(OPEN_VIEW);
  });

  it('keys by chain, so the same position on another chain is its own', () => {
    const state = toggleFold(emptyRack(), 'master', 0);
    expect(viewAt(state, 'master', 0, P).folded).toBe(true);
    expect(viewAt(state, 0, 0, P).folded).toBe(false);
  });

  it('opens a folded insert again, keeping its page', () => {
    const state = toggleFold(toggleFold(showPage(emptyRack(), 2, 1, P, 2), 2, 1), 2, 1);
    expect(viewAt(state, 2, 1, P)).toEqual({ page: 2, folded: false });
  });

  it('forgets an insert that is back on page 1 and open', () => {
    expect(toggleFold(toggleFold(emptyRack(), 1, 0), 1, 0).size).toBe(0);
    expect(showPage(showPage(emptyRack(), 1, 0, P, 2), 1, 0, P, 0).size).toBe(0);
  });
});

describe('afterMove', () => {
  it("swaps the two inserts' views with them", () => {
    const state = showPage(toggleFold(emptyRack(), 1, 0), 1, 1, P, 2);
    const moved = afterMove(state, 1, { index: 0, delta: 1, length: 3 });
    expect(viewAt(moved, 1, 0, P)).toEqual({ page: 2, folded: false });
    expect(viewAt(moved, 1, 1, P)).toEqual({ page: 0, folded: true });
    expect(viewAt(moved, 1, 2, P)).toEqual(OPEN_VIEW);
  });

  it('changes nothing for a move off either end', () => {
    const state = toggleFold(emptyRack(), 1, 0);
    expect(afterMove(state, 1, { index: 0, delta: -1, length: 2 })).toBe(state);
    expect(afterMove(state, 1, { index: 1, delta: 1, length: 2 })).toBe(state);
  });
});

describe('afterRemove', () => {
  it('shifts the later views down one and drops the last', () => {
    let state = toggleFold(emptyRack(), 1, 0);
    state = showPage(state, 1, 2, P, 1);
    state = toggleFold(state, 1, 3);
    const removed = afterRemove(state, 1, 1, 4);
    expect(viewAt(removed, 1, 0, P)).toEqual({ page: 0, folded: true });
    expect(viewAt(removed, 1, 1, P)).toEqual({ page: 1, folded: false });
    expect(viewAt(removed, 1, 2, P)).toEqual({ page: 0, folded: true });
    expect(viewAt(removed, 1, 3, P)).toEqual(OPEN_VIEW);
  });

  it('leaves another chain alone', () => {
    const state = toggleFold(emptyRack(), 'master', 1);
    expect(viewAt(afterRemove(state, 1, 0, 2), 'master', 1, P).folded).toBe(true);
  });
});

describe('afterAdd', () => {
  it('starts an insert added at the back on page 1, open, whatever was left there', () => {
    const stale = showPage(toggleFold(emptyRack(), 1, 2), 1, 2, P, 1);
    expect(viewAt(afterAdd(stale, 1, 2, 2), 1, 2, P)).toEqual(OPEN_VIEW);
  });

  it('shifts every view up one for an insert added at the front', () => {
    let state = toggleFold(emptyRack(), 1, 0);
    state = showPage(state, 1, 1, P, 2);
    const added = afterAdd(state, 1, 0, 2);
    expect(viewAt(added, 1, 0, P)).toEqual(OPEN_VIEW);
    expect(viewAt(added, 1, 1, P)).toEqual({ page: 0, folded: true });
    expect(viewAt(added, 1, 2, P)).toEqual({ page: 2, folded: false });
  });

  it('adds the first insert of an empty chain open', () => {
    expect(viewAt(afterAdd(emptyRack(), 'master', 0, 0), 'master', 0, P)).toEqual(OPEN_VIEW);
  });
});

describe('syncChain', () => {
  type Rack = { readonly view: RackView; readonly seen: RackSeen };
  /** A rack that has rendered chain 1 holding `kinds` once. */
  const rendered = (kinds: readonly string[]): Rack =>
    syncChain({ view: emptyRack(), seen: emptySeen() }, 1, kinds);
  /** One of the rack's own edits: the forward shift, and the new kinds recorded. */
  const edit = (rack: Rack, view: RackView, kinds: readonly string[]): Rack => ({
    view,
    seen: recordKinds(rack.seen, 1, kinds),
  });

  it('resets the chain when an undo takes back an add at the front', () => {
    let rack = rendered(['eq', 'drive']);
    rack = { ...rack, view: toggleFold(rack.view, 1, 0) };
    rack = edit(rack, afterAdd(rack.view, 1, 0, 2), ['comp', 'eq', 'drive']);
    rack = syncChain(rack, 1, ['comp', 'eq', 'drive']);
    expect(viewAt(rack.view, 1, 1, P).folded).toBe(true);
    const undone = syncChain(rack, 1, ['eq', 'drive']);
    for (const at of [0, 1, 2]) expect(viewAt(undone.view, 1, at, P)).toEqual(OPEN_VIEW);
    expect(undone.view.size).toBe(0);
  });

  it('keeps the fold and page through a knob-only change and its undo', () => {
    let rack = rendered(['eq', 'drive']);
    rack = { ...rack, view: showPage(toggleFold(rack.view, 1, 0), 1, 1, P, 2) };
    const again = syncChain(syncChain(rack, 1, ['eq', 'drive']), 1, ['eq', 'drive']);
    expect(again).toBe(rack);
    expect(viewAt(again.view, 1, 0, P)).toEqual({ page: 0, folded: true });
    expect(viewAt(again.view, 1, 1, P)).toEqual({ page: 2, folded: false });
  });

  it('resets the chain when an undo takes back a move', () => {
    let rack = rendered(['eq', 'drive']);
    rack = { ...rack, view: toggleFold(rack.view, 1, 0) };
    const moved = afterMove(rack.view, 1, { index: 0, delta: 1, length: 2 });
    rack = syncChain(edit(rack, moved, ['drive', 'eq']), 1, ['drive', 'eq']);
    expect(viewAt(rack.view, 1, 1, P).folded).toBe(true);
    const undone = syncChain(rack, 1, ['eq', 'drive']);
    expect(viewAt(undone.view, 1, 0, P)).toEqual(OPEN_VIEW);
    expect(viewAt(undone.view, 1, 1, P)).toEqual(OPEN_VIEW);
  });

  it('resets the chain when a redo puts back a remove', () => {
    let rack = rendered(['eq', 'drive', 'comp']);
    rack = { ...rack, view: toggleFold(rack.view, 1, 2) };
    rack = syncChain(edit(rack, afterRemove(rack.view, 1, 1, 3), ['eq', 'comp']), 1, [
      'eq',
      'comp',
    ]);
    expect(viewAt(rack.view, 1, 1, P).folded).toBe(true);
    const undone = syncChain(rack, 1, ['eq', 'drive', 'comp']);
    expect(undone.view.size).toBe(0);
    const refolded = { ...undone, view: toggleFold(undone.view, 1, 0) };
    const redone = syncChain(refolded, 1, ['eq', 'comp']);
    expect(viewAt(redone.view, 1, 0, P)).toEqual(OPEN_VIEW);
    expect(viewAt(redone.view, 1, 1, P)).toEqual(OPEN_VIEW);
  });

  it('resets only the chain whose kinds changed', () => {
    let rack = syncChain(rendered(['eq']), 11, ['drive']);
    rack = { ...rack, view: toggleFold(toggleFold(rack.view, 1, 0), 11, 0) };
    const next = syncChain(rack, 1, ['comp']);
    expect(viewAt(next.view, 1, 0, P).folded).toBe(false);
    expect(viewAt(next.view, 11, 0, P).folded).toBe(true);
    expect(viewAt(resetChain(rack.view, 11), 1, 0, P).folded).toBe(true);
  });
});

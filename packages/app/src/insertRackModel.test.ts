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
  showPage,
  toggleFold,
  viewAt,
} from './insertRackModel';

describe('viewAt', () => {
  it('starts every insert on page 1, open', () => {
    expect(viewAt(emptyRack(), 3, 0, 2)).toEqual(OPEN_VIEW);
    expect(viewAt(emptyRack(), 'master', 4, 1)).toEqual(OPEN_VIEW);
  });

  it('keeps the page inside the pages the card has', () => {
    const state = showPage(emptyRack(), 1, 0, 2);
    expect(viewAt(state, 1, 0, 3).page).toBe(2);
    expect(viewAt(state, 1, 0, 1).page).toBe(0);
    expect(viewAt(state, 1, 0, 0).page).toBe(0);
  });
});

describe('showPage and toggleFold', () => {
  it('set one insert and leave the others, and the argument, alone', () => {
    const start = emptyRack();
    const paged = showPage(start, 1, 2, 1);
    const folded = toggleFold(paged, 1, 0);
    expect(viewAt(folded, 1, 2, 3)).toEqual({ page: 1, folded: false });
    expect(viewAt(folded, 1, 0, 3)).toEqual({ page: 0, folded: true });
    expect(viewAt(folded, 1, 1, 3)).toEqual(OPEN_VIEW);
    expect(start.size).toBe(0);
    expect(viewAt(paged, 1, 0, 3)).toEqual(OPEN_VIEW);
  });

  it('keys by chain, so the same position on another chain is its own', () => {
    const state = toggleFold(emptyRack(), 'master', 0);
    expect(viewAt(state, 'master', 0, 1).folded).toBe(true);
    expect(viewAt(state, 0, 0, 1).folded).toBe(false);
  });

  it('opens a folded insert again, keeping its page', () => {
    const state = toggleFold(toggleFold(showPage(emptyRack(), 2, 1, 2), 2, 1), 2, 1);
    expect(viewAt(state, 2, 1, 3)).toEqual({ page: 2, folded: false });
  });

  it('forgets an insert that is back on page 1 and open', () => {
    expect(toggleFold(toggleFold(emptyRack(), 1, 0), 1, 0).size).toBe(0);
    expect(showPage(showPage(emptyRack(), 1, 0, 2), 1, 0, 0).size).toBe(0);
  });
});

describe('afterMove', () => {
  it("swaps the two inserts' views with them", () => {
    const state = showPage(toggleFold(emptyRack(), 1, 0), 1, 1, 2);
    const moved = afterMove(state, 1, { index: 0, delta: 1, length: 3 });
    expect(viewAt(moved, 1, 0, 3)).toEqual({ page: 2, folded: false });
    expect(viewAt(moved, 1, 1, 3)).toEqual({ page: 0, folded: true });
    expect(viewAt(moved, 1, 2, 3)).toEqual(OPEN_VIEW);
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
    state = showPage(state, 1, 2, 1);
    state = toggleFold(state, 1, 3);
    const removed = afterRemove(state, 1, 1, 4);
    expect(viewAt(removed, 1, 0, 3)).toEqual({ page: 0, folded: true });
    expect(viewAt(removed, 1, 1, 3)).toEqual({ page: 1, folded: false });
    expect(viewAt(removed, 1, 2, 3)).toEqual({ page: 0, folded: true });
    expect(viewAt(removed, 1, 3, 3)).toEqual(OPEN_VIEW);
  });

  it('leaves another chain alone', () => {
    const state = toggleFold(emptyRack(), 'master', 1);
    expect(viewAt(afterRemove(state, 1, 0, 2), 'master', 1, 1).folded).toBe(true);
  });
});

describe('afterAdd', () => {
  it('starts an insert added at the back on page 1, open, whatever was left there', () => {
    const stale = showPage(toggleFold(emptyRack(), 1, 2), 1, 2, 1);
    expect(viewAt(afterAdd(stale, 1, 2, 2), 1, 2, 3)).toEqual(OPEN_VIEW);
  });

  it('shifts every view up one for an insert added at the front', () => {
    let state = toggleFold(emptyRack(), 1, 0);
    state = showPage(state, 1, 1, 2);
    const added = afterAdd(state, 1, 0, 2);
    expect(viewAt(added, 1, 0, 3)).toEqual(OPEN_VIEW);
    expect(viewAt(added, 1, 1, 3)).toEqual({ page: 0, folded: true });
    expect(viewAt(added, 1, 2, 3)).toEqual({ page: 2, folded: false });
  });

  it('adds the first insert of an empty chain open', () => {
    expect(viewAt(afterAdd(emptyRack(), 'master', 0, 0), 'master', 0, 1)).toEqual(OPEN_VIEW);
  });
});

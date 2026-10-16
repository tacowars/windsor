/**
 * The lane menu's document watch (windsor#827 decision 6): opening and
 * dismissing menus leaves no listener piling up in the model's set.
 */
import { describe, expect, it } from 'vitest';

import { LaneMenuWatch } from './laneMenuWatch';

/** A model's listener set, as `DocumentModel.onChange` keeps it, with a change to fire. */
function model(): {
  subscribe: (l: () => void) => () => void;
  listeners: Set<() => void>;
  change(): void;
} {
  const listeners = new Set<() => void>();
  return {
    listeners,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    change: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('LaneMenuWatch', () => {
  it('keeps one listener however many menus open and are dismissed without an edit', () => {
    const doc = model();
    const watch = new LaneMenuWatch();
    const closed: number[] = [];
    for (let i = 0; i < 5; i++) watch.start(doc.subscribe, () => closed.push(i));
    expect(doc.listeners.size).toBe(1);
    doc.change();
    // Only the open menu closes, and nothing is left listening.
    expect(closed).toEqual([4]);
    expect(doc.listeners.size).toBe(0);
    expect(watch.watching).toBe(false);
  });

  it('leaves none once a row runs, the change it makes closing nothing more', () => {
    const doc = model();
    const watch = new LaneMenuWatch();
    let closes = 0;
    watch.start(doc.subscribe, () => closes++);
    watch.stop();
    doc.change();
    expect(doc.listeners.size).toBe(0);
    expect(closes).toBe(0);
  });
});

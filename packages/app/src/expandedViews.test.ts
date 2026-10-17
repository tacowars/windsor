/**
 * The expanded views' rules (record `2026-10-17-expanded-views-below-the-header`
 * decisions 5 and 7): one open at a time, a tab switch hides a view without
 * closing it, and its keys act only while it is on screen.
 */
import { describe, expect, it } from 'vitest';

import { type ExpandedView, ExpandedViews } from './expandedViews';

function view(): ExpandedView & { closes: number } {
  const v = {
    closes: 0,
    close: () => {
      v.closes++;
    },
  };
  return v;
}

describe('ExpandedViews', () => {
  it('opening a view closes the one open before it', () => {
    const views = new ExpandedViews();
    const roll = view();
    const bench = view();
    views.opened(roll);
    views.opened(bench);
    expect(roll.closes).toBe(1);
    expect(views.isOpen(roll)).toBe(false);
    expect(views.shown(bench)).toBe(true);
    // The first view's own close, arriving after, leaves the second open.
    views.closed(roll);
    expect(views.isOpen(bench)).toBe(true);
  });

  it('opening the open view again closes nothing', () => {
    const views = new ExpandedViews();
    const roll = view();
    views.opened(roll);
    views.opened(roll);
    expect(roll.closes).toBe(0);
    expect(views.shown(roll)).toBe(true);
  });

  it('another tab hides the view, keeps it open, and its keys stop until the tab is back', () => {
    const views = new ExpandedViews();
    const roll = view();
    views.opened(roll);
    views.tabShown(roll, false);
    expect(views.isOpen(roll)).toBe(true);
    expect(views.shown(roll)).toBe(false);
    expect(roll.closes).toBe(0);
    views.tabShown(roll, true);
    expect(views.shown(roll)).toBe(true);
  });

  it('a closed view is neither open nor shown, and its tab no longer moves anything', () => {
    const views = new ExpandedViews();
    const roll = view();
    const bench = view();
    views.opened(roll);
    views.closed(roll);
    expect(views.isOpen(roll)).toBe(false);
    views.opened(bench);
    views.tabShown(roll, false);
    expect(views.shown(bench)).toBe(true);
  });
});

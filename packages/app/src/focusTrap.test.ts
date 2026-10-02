/**
 * Modal focus (#563): Tab wraps inside the dialog, and closing returns focus
 * to the control that opened it — the patch controls — so QWERTY plays
 * straight away (#511's lesson about focus stranded on a control). No DOM: a
 * focusable is anything with `focus()`, which is all the trap reads.
 */
import { describe, expect, it } from 'vitest';

import { FocusReturn, tabWrapTarget } from './focusTrap';

class Fake {
  focused = 0;
  constructor(readonly label: string) {}
  focus(): void {
    this.focused++;
  }
}

describe('tabWrapTarget', () => {
  const [a, b, c] = [new Fake('a'), new Fake('b'), new Fake('c')];
  const all = [a, b, c];

  it('wraps forward from the last to the first and backward from the first to the last', () => {
    expect(tabWrapTarget(all, c, false)).toBe(a);
    expect(tabWrapTarget(all, a, true)).toBe(c);
  });
  it('leaves a move that stays inside to the browser', () => {
    expect(tabWrapTarget(all, a, false)).toBeNull();
    expect(tabWrapTarget(all, b, true)).toBeNull();
  });
  it('pulls focus in from outside the dialog, and has nowhere to go with no focusables', () => {
    expect(tabWrapTarget(all, null, false)).toBe(a);
    expect(tabWrapTarget(all, new Fake('outside'), true)).toBe(c);
    expect(tabWrapTarget([], a, false)).toBeNull();
  });
});

describe('FocusReturn', () => {
  it('returns focus to the opener on close', () => {
    const saveButton = new Fake('Save');
    const fallback = new Fake('Load patch');
    const ret = new FocusReturn(() => fallback);
    ret.open(saveButton);
    expect(ret.close()).toBe(saveButton);
    expect(saveButton.focused).toBe(1);
    expect(fallback.focused).toBe(0);
  });
  it('falls back to the patch controls when nothing opened it, every close', () => {
    const fallback = new Fake('Load patch');
    const ret = new FocusReturn(() => fallback);
    ret.open(null);
    expect(ret.close()).toBe(fallback);
    // A second close after a modal opened from a button that has since been
    // re-rendered away: the fallback again, never a stale opener.
    const gone = new Fake('gone');
    ret.open(gone);
    ret.close();
    expect(ret.close()).toBe(fallback);
    expect(fallback.focused).toBe(2);
    expect(gone.focused).toBe(1);
  });
});

describe('a dialog opened from a row menu', () => {
  it('returns focus to the row’s ⋯ button, which outlives the removed menu item', () => {
    // Rename… and Edit tags… close their menu before the dialog opens, so the
    // element that had focus is gone; the dialog is given the ⋯ button instead.
    const more = new Fake('⋯');
    const fallback = new Fake('Load patch');
    const ret = new FocusReturn(() => fallback);
    ret.open(more);
    expect(ret.close()).toBe(more);
    expect(more.focused).toBe(1);
    expect(fallback.focused).toBe(0);
  });
});

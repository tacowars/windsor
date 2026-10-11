/**
 * A Roll card's popovers live as long as the card (PR #715 fix round 2,
 * windsor#708 fix round 2): a redraw of the card closes them, so does the
 * card leaving the page or its tab hiding, and a pick through a card that
 * left the page writes nothing.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  closeRollPopovers,
  holdRollPopover,
  keepRollPopovers,
  ownedPick,
  releaseRollPopover,
} from './rollPopoverLife';
import { type ShapeLife, shapeLife } from './songShapeLife';

describe('the envelope list and its card', () => {
  it('closes the open list when the pane redraws, and a second opening replaces the first', () => {
    const card = {};
    const first = vi.fn(() => releaseRollPopover('list', first));
    const second = vi.fn(() => releaseRollPopover('list', second));
    holdRollPopover('list', first, card);
    holdRollPopover('list', second, card);
    expect(first).toHaveBeenCalledOnce();
    closeRollPopovers();
    closeRollPopovers();
    expect(second).toHaveBeenCalledOnce();
  });

  it('refuses a pick once its card is detached, and writes while it is live', () => {
    let live = true;
    const write = vi.fn();
    const pick = ownedPick({ live: () => live }, () => undefined, write);
    expect(pick('ops.0.level')).toBe(true);
    live = false;
    expect(pick('ops.1.level')).toBe(false);
    expect(write.mock.calls).toEqual([['ops.0.level']]);
  });
});

describe('the Shape tool and its card', () => {
  /** A Shape selection held by `card`, its listeners on a stand-in window that counts them. */
  function openShape(card: object): { life: ShapeLife; listening: () => number } {
    const target = new EventTarget();
    let listening = 0;
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = (...args: Parameters<EventTarget['addEventListener']>) => {
      listening++;
      add(...args);
    };
    target.removeEventListener = (...args: Parameters<EventTarget['removeEventListener']>) => {
      listening--;
      remove(...args);
    };
    const life = shapeLife(
      target,
      { onKey: () => undefined, place: () => undefined },
      {
        hold: (close) => holdRollPopover('shape', close, card),
        release: (close) => releaseRollPopover('shape', close),
      },
    );
    life.open(() => life.close());
    return { life, listening: () => listening };
  }

  it("closes with its listeners when its card hides or leaves the page, not another card's", () => {
    const card = {};
    const shape = openShape(card);
    expect(shape.life.isOpen()).toBe(true);
    expect(shape.listening()).toBe(3);
    expect(keepRollPopovers({}, false)).toBe(false);
    expect(keepRollPopovers(card, true)).toBe(true);
    expect(shape.life.isOpen()).toBe(true);
    keepRollPopovers(card, false);
    expect(shape.life.isOpen()).toBe(false);
    expect(shape.listening()).toBe(0);
  });

  it('closes with its listeners when the pane redraws the card', () => {
    const shape = openShape({});
    closeRollPopovers();
    expect(shape.life.isOpen()).toBe(false);
    expect(shape.listening()).toBe(0);
  });
});

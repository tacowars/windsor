/**
 * The Euclid card's press hold (windsor#356): a press sets `pressing` until
 * the pointer is let go, and its end listeners go with it, so the window
 * keeps nothing that holds the card.
 */
import { describe, expect, it } from 'vitest';

import { holdWhilePressed } from './euclidPressHold';

/** A window stand-in that counts the listeners still attached to it. */
class CountingTarget extends EventTarget {
  live = 0;

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    super.addEventListener(type, listener, options);
    this.live++;
    const signal = typeof options === 'object' ? options.signal : undefined;
    signal?.addEventListener('abort', () => this.live--, { once: true });
  }
}

const press = (rows: EventTarget, scope: EventTarget, end: string): void => {
  rows.dispatchEvent(new Event('pointerdown'));
  scope.dispatchEvent(new Event(end));
};

describe('the press hold', () => {
  it('holds from the press until the pointer is let go or cancelled', () => {
    const card = { pressing: false };
    const rows = new EventTarget();
    const scope = new CountingTarget();
    holdWhilePressed(card, rows, scope);
    rows.dispatchEvent(new Event('pointerdown'));
    expect(card.pressing).toBe(true);
    scope.dispatchEvent(new Event('pointercancel'));
    expect(card.pressing).toBe(false);
  });

  it('leaves no listener on the window after several presses, however each ends', () => {
    const card = { pressing: false };
    const rows = new EventTarget();
    const scope = new CountingTarget();
    holdWhilePressed(card, rows, scope);
    for (const end of ['pointerup', 'pointerup', 'pointercancel', 'pointerup']) {
      press(rows, scope, end);
      expect(card.pressing).toBe(false);
    }
    expect(scope.live).toBe(0);
    // Nothing stale answers a later end: a press set by hand stays set.
    card.pressing = true;
    scope.dispatchEvent(new Event('pointerup'));
    scope.dispatchEvent(new Event('pointercancel'));
    expect(card.pressing).toBe(true);
  });
});

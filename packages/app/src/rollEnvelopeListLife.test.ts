/**
 * The envelope list lives as long as its Roll card (PR #715 fix round 2):
 * a redraw of the card closes it, and a pick through a card that left the
 * page writes nothing.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  closeEnvelopeList,
  holdEnvelopeList,
  ownedPick,
  releaseEnvelopeList,
} from './rollEnvelopeListLife';

describe('the envelope list and its card', () => {
  it('closes the open list when the pane redraws, and a second opening replaces the first', () => {
    const first = vi.fn(() => releaseEnvelopeList(first));
    const second = vi.fn(() => releaseEnvelopeList(second));
    holdEnvelopeList(first);
    holdEnvelopeList(second);
    expect(first).toHaveBeenCalledOnce();
    closeEnvelopeList();
    closeEnvelopeList();
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

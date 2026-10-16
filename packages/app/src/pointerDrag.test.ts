/**
 * The press-or-drag threshold (record
 * `2026-10-07-song-region-drag-across-parts` decision 8): horizontal travel
 * only by default, the farther axis for a press opted into both.
 */
import { describe, expect, it } from 'vitest';

import { longPressMoved } from './longPressModel';
import { laneDragStarts, pastThreshold } from './pointerDrag';
import { SONG_DRAG_THRESHOLD_PX } from './songViewTables';

describe('the drag threshold', () => {
  const T = SONG_DRAG_THRESHOLD_PX;

  it('counts only horizontal travel unless the press opts into both axes', () => {
    expect(pastThreshold({ dx: 0, dy: 3 * T, bothAxes: false })).toBe(false);
    expect(pastThreshold({ dx: -T, dy: 0, bothAxes: false })).toBe(true);
    expect(pastThreshold({ dx: T - 1, dy: 0, bothAxes: false })).toBe(false);
  });

  it('with both axes, a straight vertical drag starts', () => {
    expect(pastThreshold({ dx: 0, dy: T, bothAxes: true })).toBe(true);
    expect(pastThreshold({ dx: 0, dy: -T, bothAxes: true })).toBe(true);
    expect(pastThreshold({ dx: 1, dy: T - 1, bothAxes: true })).toBe(false);
  });
});

describe('a part lane’s drag start (windsor#826, record 2026-10-16-song-tab-context-menu decision 9)', () => {
  const drags = (pointerType: string, dx: number, dy = 0, bothAxes = false): boolean =>
    laneDragStarts(pointerType, { dx, dy, bothAxes });

  it('lets a touch or pen press wobble 6 px and starts its drag at 9', () => {
    for (const pointerType of ['touch', 'pen']) {
      expect(drags(pointerType, 6)).toBe(false);
      expect(drags(pointerType, 9)).toBe(true);
    }
  });

  it('starts a touch or pen drag exactly when its long press cancels, diagonally too, on a gap or a body', () => {
    const origin = { x: 0, y: 0 };
    for (const pointerType of ['touch', 'pen']) {
      for (const bothAxes of [false, true]) {
        for (const [dx, dy] of [
          [6, 6],
          [-6, 6],
          [0, 9],
          [0, 6],
          [5, 5],
        ] as const) {
          const cancelled = longPressMoved(origin, { x: dx, y: dy });
          expect(drags(pointerType, dx, dy, bothAxes)).toBe(cancelled);
        }
      }
      // The case that fell through to a click: 6 × 6 cancels the long press, so it is a drag.
      expect(drags(pointerType, 6, 6)).toBe(true);
    }
  });

  it('keeps the mouse’s drag at 4 px on its own axis', () => {
    expect(drags('mouse', 3)).toBe(false);
    expect(drags('mouse', SONG_DRAG_THRESHOLD_PX)).toBe(true);
    expect(drags('mouse', 3, 3)).toBe(false);
    expect(drags('mouse', 0, SONG_DRAG_THRESHOLD_PX, true)).toBe(true);
  });
});

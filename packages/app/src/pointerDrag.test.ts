/**
 * The press-or-drag threshold (record
 * `2026-10-07-song-region-drag-across-parts` decision 8): horizontal travel
 * only by default, the farther axis for a press opted into both.
 */
import { describe, expect, it } from 'vitest';

import { pastThreshold } from './pointerDrag';
import { SONG_DRAG_THRESHOLD_PX, laneDragThresholdPx } from './songViewTables';

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

describe('a part lane’s threshold (windsor#826, record 2026-10-16-song-tab-context-menu decision 9)', () => {
  const drags = (pointerType: string, dx: number): boolean =>
    pastThreshold({ dx, dy: 0, bothAxes: false }, laneDragThresholdPx(pointerType));

  it('lets a touch or pen press wobble 6 px and starts its drag at 9', () => {
    for (const pointerType of ['touch', 'pen']) {
      expect(drags(pointerType, 6)).toBe(false);
      expect(drags(pointerType, 9)).toBe(true);
    }
  });

  it('keeps the mouse’s drag at 4 px', () => {
    expect(laneDragThresholdPx('mouse')).toBe(SONG_DRAG_THRESHOLD_PX);
    expect(drags('mouse', 3)).toBe(false);
    expect(drags('mouse', 4)).toBe(true);
  });
});

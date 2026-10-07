/**
 * The press-or-drag threshold (record
 * `2026-10-07-song-region-drag-across-parts` decision 8): horizontal travel
 * only by default, the farther axis for a press opted into both.
 */
import { describe, expect, it } from 'vitest';

import { pastThreshold } from './pointerDrag';
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

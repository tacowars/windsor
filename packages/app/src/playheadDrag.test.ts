import { TICKS_PER_BAR } from '@windsor/engine';
import { describe, expect, it } from 'vitest';

import {
  barTick,
  canDragPlayhead,
  pressStartsDrag,
  snapBar,
  stepPlayheadDrag,
  type PlayheadDrag,
  type PlayheadDragGeometry,
} from './playheadDrag';
import { SONG_DRAG_THRESHOLD_PX } from './songViewTables';

const SONG: PlayheadDragGeometry = { pxPerBar: 40, bars: 16 };

describe('canDragPlayhead (decision 1)', () => {
  it('is stopped or paused with audio on, never while playing or before audio', () => {
    expect(canDragPlayhead({ enabled: true, running: false })).toBe(true);
    expect(canDragPlayhead({ enabled: true, running: true })).toBe(false);
    expect(canDragPlayhead({ enabled: false, running: false })).toBe(false);
  });

  it('starts a drag on the primary button only', () => {
    const halted = { enabled: true, running: false };
    expect(pressStartsDrag(0, halted)).toBe(true);
    expect(pressStartsDrag(2, halted)).toBe(false);
    expect(pressStartsDrag(0, { enabled: true, running: true })).toBe(false);
  });
});

describe('snapBar (decision 3 and 4)', () => {
  it('snaps to the nearest bar line, half-way taking the later one', () => {
    expect(snapBar(0, SONG)).toBe(0);
    expect(snapBar(3 * 40 + 19, SONG)).toBe(3);
    expect(snapBar(3 * 40 + 20, SONG)).toBe(4);
    expect(snapBar(3 * 40 + 21, SONG)).toBe(4);
    expect(snapBar(4 * 40 - 1, SONG)).toBe(4);
  });

  it('lands a drop before bar 1 on bar 1 and one past the end on the last bar', () => {
    expect(snapBar(-500, SONG)).toBe(0);
    expect(snapBar(-19, SONG)).toBe(0);
    expect(snapBar(15 * 40, SONG)).toBe(15);
    expect(snapBar(15 * 40 + 30, SONG)).toBe(15);
    expect(snapBar(16 * 40, SONG)).toBe(15);
    expect(snapBar(10_000, SONG)).toBe(15);
  });

  it('snaps the same bar at any zoom', () => {
    for (const pxPerBar of [4, 12.5, 40, 96, 333]) {
      const geometry = { pxPerBar, bars: 16 };
      expect(snapBar(7 * pxPerBar, geometry)).toBe(7);
      expect(snapBar(7.49 * pxPerBar, geometry)).toBe(7);
      expect(snapBar(7.5 * pxPerBar, geometry)).toBe(8);
      expect(snapBar(20 * pxPerBar, geometry)).toBe(15);
    }
  });

  it('answers bar 1 for a song with no bars or a ruler with no width', () => {
    expect(snapBar(100, { pxPerBar: 40, bars: 0 })).toBe(0);
    expect(snapBar(100, { pxPerBar: 0, bars: 16 })).toBe(0);
    expect(snapBar(Number.NaN, SONG)).toBe(0);
  });

  it('puts a bar on its transport tick', () => {
    expect(barTick(0)).toBe(0);
    expect(barTick(2)).toBe(2 * TICKS_PER_BAR);
  });
});

describe('stepPlayheadDrag', () => {
  const pressed: PlayheadDrag = { pointerId: 1, originX: 100, bar: null };
  const move = (clientX: number, px: number, buttons = 1, pointerId = 1) =>
    ({ type: 'move', pointerId, buttons, clientX, px }) as const;

  it('previews nothing inside the threshold, then the snapped bar', () => {
    const still = stepPlayheadDrag(pressed, move(100 + SONG_DRAG_THRESHOLD_PX - 1, 83), SONG);
    expect(still).toEqual({ drag: pressed, preview: null, drop: null });
    const moved = stepPlayheadDrag(pressed, move(160, 143), SONG);
    expect(moved.preview).toBe(4);
    expect(moved.drag?.bar).toBe(4);
    // Once moving, a return to the origin still previews.
    const back = stepPlayheadDrag(moved.drag, move(100, 83), SONG);
    expect(back.preview).toBe(2);
  });

  it('drops on the previewed bar at the release, and on nothing for a press that never moved', () => {
    const moved = stepPlayheadDrag(pressed, move(160, 143), SONG).drag;
    expect(stepPlayheadDrag(moved, { type: 'up', pointerId: 1 }, SONG)).toEqual({
      drag: null,
      preview: null,
      drop: 4,
    });
    expect(stepPlayheadDrag(pressed, { type: 'up', pointerId: 1 }, SONG).drop).toBeNull();
  });

  it('drops where the line shows on a move with the button up (a missed release)', () => {
    const moved = stepPlayheadDrag(pressed, move(160, 143), SONG).drag;
    expect(stepPlayheadDrag(moved, move(300, 283, 0), SONG)).toEqual({
      drag: null,
      preview: null,
      drop: 4,
    });
  });

  it('ends with no drop on a cancel, and ignores another pointer', () => {
    const moved = stepPlayheadDrag(pressed, move(160, 143), SONG).drag;
    expect(stepPlayheadDrag(moved, { type: 'cancel' }, SONG)).toEqual({
      drag: null,
      preview: null,
      drop: null,
    });
    const other = stepPlayheadDrag(moved, move(400, 383, 1, 2), SONG);
    expect(other).toEqual({ drag: moved, preview: null, drop: null });
    expect(stepPlayheadDrag(null, move(160, 143), SONG).drag).toBeNull();
  });
});

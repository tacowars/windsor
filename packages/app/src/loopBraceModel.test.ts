/**
 * The loop brace's rules (windsor#30): hit-testing a press, drawing,
 * resizing and moving the range with bar and beat snaps, and the partial an
 * edit writes. Every result is also checked against the engine's own fitting
 * rule, so the brace never hands the document a range it would repair.
 */
import { describe, expect, it } from 'vitest';

import { LOOP_GRID_TICKS, PPQ, TICKS_PER_BAR, fitLoopRange } from '@windsor/engine';
import type { BraceGesture, LoopRange } from './loopBraceModel';
import {
  braceBox,
  braceGestureAt,
  braceHitAt,
  dragBrace,
  drawRange,
  loopChange,
  loopGrain,
  loopLineTicks,
  newLoopRange,
} from './loopBraceModel';
import { LOOP_BRACE, SONG_VIEW, tickToPx } from './songViewTables';

const BAR = TICKS_PER_BAR;
const BEAT = PPQ;
const SONG = 8 * BAR;
const PX = SONG_VIEW.pxPerBar;
const bars = { grain: loopGrain(false), songTicks: SONG };
const beats = { grain: loopGrain(true), songTicks: SONG };

/** A range the engine keeps as it is: on the beat grid, inside the song, never empty. */
function expectKept(range: LoopRange, songTicks = SONG): void {
  expect(fitLoopRange(range.start, range.end, songTicks)).toEqual(range);
  expect(range.end - range.start).toBeGreaterThanOrEqual(LOOP_GRID_TICKS);
}

describe('the snap (decision 3)', () => {
  it('snaps to bars, and to beats with Shift', () => {
    expect(loopGrain(false)).toBe(BAR);
    expect(loopGrain(true)).toBe(BEAT);
    expect(LOOP_GRID_TICKS).toBe(BEAT);
  });
});

describe('the range the loop button creates', () => {
  it('is bars 1–4, clamped to the song', () => {
    expect(newLoopRange(SONG)).toEqual({ start: 0, end: 4 * BAR });
    expect(newLoopRange(2 * BAR)).toEqual({ start: 0, end: 2 * BAR });
    expect(newLoopRange(BAR)).toEqual({ start: 0, end: BAR });
    expect(LOOP_BRACE.newLoopBars).toBe(4);
  });
});

describe('hit-testing a press on the strip', () => {
  const loop = { start: 2 * BAR, end: 4 * BAR };
  const left = tickToPx(loop.start, PX);
  const right = tickToPx(loop.end, PX);

  it('draws the brace over the range at the view scale', () => {
    expect(braceBox(loop, PX)).toEqual({ leftPx: left, widthPx: right - left });
  });

  it('hits the handles inside each end, the body between, nothing outside', () => {
    expect(braceHitAt(loop, left + 1, PX)).toBe('start');
    expect(braceHitAt(loop, right - 1, PX)).toBe('end');
    expect(braceHitAt(loop, (left + right) / 2, PX)).toBe('body');
    expect(braceHitAt(loop, left - LOOP_BRACE.handleOutsidePx - 1, PX)).toBeNull();
    expect(braceHitAt(loop, right + LOOP_BRACE.handleOutsidePx + 1, PX)).toBeNull();
    expect(braceHitAt(undefined, left, PX)).toBeNull();
  });

  it('reaches a little outside each end, so a handle stays grabbable zoomed out', () => {
    expect(braceHitAt(loop, left - LOOP_BRACE.handleOutsidePx, PX)).toBe('start');
    expect(braceHitAt(loop, right + LOOP_BRACE.handleOutsidePx, PX)).toBe('end');
  });

  it('keeps a body in the middle of a narrow brace', () => {
    const narrowPx = SONG_VIEW.minPxPerBar;
    const beatLoop = { start: 2 * BAR, end: 2 * BAR + BEAT };
    const box = braceBox(beatLoop, narrowPx);
    expect(braceHitAt(beatLoop, box.leftPx + box.widthPx / 2, narrowPx)).toBe('body');
  });

  it('starts a draw in empty space, an edit on the brace', () => {
    expect(braceGestureAt(loop, tickToPx(6 * BAR, PX), PX)).toEqual({
      kind: 'draw',
      anchorTick: 6 * BAR,
    });
    expect(braceGestureAt(undefined, left, PX)).toEqual({ kind: 'draw', anchorTick: 2 * BAR });
    expect(braceGestureAt(loop, right - 1, PX)).toMatchObject({ kind: 'end', range: loop });
  });
});

describe('drawing a range in empty strip space', () => {
  it('covers every bar the drag touches, either direction', () => {
    expect(drawRange(2.5 * BAR, 4.2 * BAR, bars)).toEqual({ start: 2 * BAR, end: 5 * BAR });
    expect(drawRange(4.2 * BAR, 2.5 * BAR, bars)).toEqual({ start: 2 * BAR, end: 5 * BAR });
  });

  it('snaps to beats with Shift', () => {
    expect(drawRange(2 * BAR + 10, 2 * BAR + 50, beats)).toEqual({
      start: 2 * BAR,
      end: 2 * BAR + 3 * BEAT,
    });
  });

  it('never has zero length, even on a grid line', () => {
    expect(drawRange(3 * BAR, 3 * BAR, bars)).toEqual({ start: 3 * BAR, end: 4 * BAR });
    expect(drawRange(3 * BAR, 3 * BAR, beats)).toEqual({ start: 3 * BAR, end: 3 * BAR + BEAT });
  });

  it('never goes past the song ends', () => {
    expect(drawRange(-BAR, 3.5 * BAR, bars)).toEqual({ start: 0, end: 4 * BAR });
    expect(drawRange(6.5 * BAR, 12 * BAR, bars)).toEqual({ start: 6 * BAR, end: SONG });
    expect(drawRange(SONG, SONG + BAR, bars)).toEqual({ start: SONG - BAR, end: SONG });
    expect(drawRange(SONG, SONG, beats)).toEqual({ start: SONG - BEAT, end: SONG });
  });
});

describe('dragging a handle', () => {
  const range = { start: 2 * BAR, end: 5 * BAR };
  const start: BraceGesture = { kind: 'start', range, pressTick: 2 * BAR + 5 };
  const end: BraceGesture = { kind: 'end', range, pressTick: 5 * BAR - 5 };

  it('moves that end by the pointer travel, snapped to bars', () => {
    expect(dragBrace(start, 2 * BAR + 5 - 0.6 * BAR, bars)).toEqual({
      start: BAR,
      end: 5 * BAR,
    });
    expect(dragBrace(end, 5 * BAR - 5 + 1.4 * BAR, bars)).toEqual({ start: 2 * BAR, end: 6 * BAR });
  });

  it('does not jump when the press sat a few px off the edge', () => {
    expect(dragBrace(start, 2 * BAR + 5 + 3, bars)).toEqual(range);
    expect(dragBrace(end, 5 * BAR - 5 - 3, bars)).toEqual(range);
  });

  it('snaps to beats with Shift', () => {
    expect(dragBrace(end, 5 * BAR - 5 + BEAT + 2, beats)).toEqual({
      start: 2 * BAR,
      end: 5 * BAR + BEAT,
    });
  });

  it('stops a beat short of the other end, so the loop is never empty', () => {
    expect(dragBrace(start, 9 * BAR, bars)).toEqual({ start: 5 * BAR - BEAT, end: 5 * BAR });
    expect(dragBrace(end, -4 * BAR, bars)).toEqual({ start: 2 * BAR, end: 2 * BAR + BEAT });
  });

  it('stops at the song ends', () => {
    expect(dragBrace(start, -10 * BAR, bars)).toEqual({ start: 0, end: 5 * BAR });
    expect(dragBrace(end, 20 * BAR, bars)).toEqual({ start: 2 * BAR, end: SONG });
  });
});

describe('dragging the body', () => {
  const range = { start: 2 * BAR, end: 4 * BAR };
  const body: BraceGesture = { kind: 'body', range, pressTick: 3 * BAR };

  it('moves the whole range by the pointer travel, snapped to bars', () => {
    expect(dragBrace(body, 4.4 * BAR, bars)).toEqual({ start: 3 * BAR, end: 5 * BAR });
    expect(dragBrace(body, 3.3 * BAR, bars)).toEqual(range);
  });

  it('snaps to beats with Shift', () => {
    expect(dragBrace(body, 3 * BAR + BEAT + 3, beats)).toEqual({
      start: 2 * BAR + BEAT,
      end: 4 * BAR + BEAT,
    });
  });

  it('keeps its length and stays inside the song', () => {
    expect(dragBrace(body, 20 * BAR, bars)).toEqual({ start: 6 * BAR, end: SONG });
    expect(dragBrace(body, -20 * BAR, bars)).toEqual({ start: 0, end: 2 * BAR });
  });
});

describe('every drag lands on a range the engine keeps', () => {
  const range = { start: 2 * BAR + BEAT, end: 5 * BAR };
  const gestures: BraceGesture[] = [
    { kind: 'draw', anchorTick: 3.3 * BAR },
    { kind: 'start', range, pressTick: range.start },
    { kind: 'end', range, pressTick: range.end },
    { kind: 'body', range, pressTick: 3 * BAR },
  ];
  const ticks = [-3 * BAR, 0, 1.7 * BAR, 2 * BAR + BEAT, 4.9 * BAR, SONG, 11 * BAR];

  it.each(gestures.map((g) => [g.kind, g] as const))('%s', (_kind, gesture) => {
    for (const tick of ticks) {
      expectKept(dragBrace(gesture, tick, bars));
      expectKept(dragBrace(gesture, tick, beats));
    }
  });
});

describe('the lines through the lanes and the partial', () => {
  it('marks both ends while the loop is on, nothing while it is off or absent', () => {
    expect(loopLineTicks({ start: BAR, end: 3 * BAR, on: true })).toEqual([BAR, 3 * BAR]);
    expect(loopLineTicks({ start: BAR, end: 3 * BAR, on: false })).toEqual([]);
    expect(loopLineTicks(undefined)).toEqual([]);
  });

  it('writes the whole loop, keeping the on state it is handed', () => {
    expect(loopChange({ start: BAR, end: 3 * BAR }, false)).toEqual({
      transport: { loop: { start: BAR, end: 3 * BAR, on: false } },
    });
  });
});

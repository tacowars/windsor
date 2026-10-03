/**
 * The harmony track's geometry (windsor#550): a block hits as its event,
 * not its place in the lane, and a seam falls only where the chord changes,
 * on the engine's own `eventBounds` with the first chord starting after
 * tick 0 (the last chord's cyclic hold drawn first).
 */
import { describe, expect, it } from 'vitest';

import type { EventBounds, Harmony, HarmonyEvent } from '@windsor/engine';
import { CHORD_SIZE_TRIAD, TICKS_PER_BAR, eventBounds } from '@windsor/engine';
import { chordAtTick, harmonyGeometry, seamAfter } from './harmonyLaneGeometry';
import { laneCursor, laneHitAt, seamMarks } from './laneEditModel';

const BAR = TICKS_PER_BAR;
const PX = 96;
const SONG = 4 * BAR;
const ev = (start: number, duration: number, degree = 0): HarmonyEvent => ({
  start,
  duration,
  degree,
  size: CHORD_SIZE_TRIAD,
});
const spans = (events: HarmonyEvent[]): EventBounds[] =>
  eventBounds({ events } as unknown as Harmony, SONG);

describe('one chord starting after tick 0', () => {
  const lone = spans([ev(BAR, 3 * BAR, 3)]);

  it('hits the main block as event 0, not as box 1', () => {
    const lane = harmonyGeometry(lone, PX);
    expect(lane.boxes.map((b) => b.index)).toEqual([0, 0]);
    expect(laneHitAt(lane, 2 * PX)).toEqual({ kind: 'body', index: 0 });
    expect(laneHitAt(lane, PX / 2)).toEqual({ kind: 'body', index: 0 });
    expect(chordAtTick(lone, 2 * BAR)).toBe(0);
    expect(chordAtTick(lone, 0)).toBe(0);
  });

  it('has no seam between its wrapped hold and its own span: no mark, no cursor, no drag', () => {
    const lane = harmonyGeometry(lone, PX);
    expect(lane.seams).toEqual([]);
    const hit = laneHitAt(lane, PX);
    expect(hit.kind).toBe('body');
    expect(laneCursor('harmony', hit, false)).toBe('pointer');
    expect(seamMarks(lane.seams, 0, null)).toEqual([]);
    expect(seamAfter(lone, 0)).toBeNull();
  });
});

describe('two chords, the first starting after tick 0', () => {
  const pair = spans([ev(BAR, BAR, 1), ev(2 * BAR, 2 * BAR, 4)]);

  it('keys each block by its event and puts a seam where the chord changes, the wrap included', () => {
    const lane = harmonyGeometry(pair, PX);
    expect(lane.boxes.map((b) => b.index)).toEqual([1, 0, 1]);
    expect(lane.seams.map((s) => [s.index, s.right, s.px])).toEqual([
      [1, 0, PX],
      [0, 1, 2 * PX],
    ]);
    expect(laneHitAt(lane, 2 * PX)).toEqual({ kind: 'seam', index: 0 });
    expect(laneHitAt(lane, PX)).toEqual({ kind: 'seam', index: 1 });
    expect(laneHitAt(lane, 3 * PX)).toEqual({ kind: 'body', index: 1 });
    expect(seamAfter(pair, 1)?.map((s) => s.start)).toEqual([0, BAR]);
  });
});

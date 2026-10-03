/**
 * The lanes' shared region-editing model (windsor#550): seams are hit
 * before blocks, the nearest one winning within a zone capped at a third of
 * either neighbour, a block reports its item's index, edge zones shrink to a third of a narrow block, the cursor
 * follows the hit, the selected block's seams show faintly, and the readout
 * reads as the approved mockup's `fmtPos` / `fmtLen`.
 */
import { describe, expect, it } from 'vitest';

import { FOUR_FOUR, PPQ, TICKS_PER_BAR } from '@windsor/engine';
import type { LaneGeometry, LaneSeam } from './laneEditModel';
import {
  draggedBoundary,
  edgeZonePx,
  laneCursor,
  laneHitAt,
  lengthLabel,
  readoutPosition,
  seamMarks,
  seamReadout,
  seamZonePx,
  spanReadout,
} from './laneEditModel';
import { LANE_EDIT } from './laneEditTables';
import { BLOCK_GAP_PX, MIN_BLOCK_PX, blockBox } from './songViewTables';

const BAR = TICKS_PER_BAR;
const PX = 96;
const box = (start: number, duration: number, index: number, px = PX) => ({
  ...blockBox(start, duration, px),
  index,
});
/** The seam where block `index` of `leftBars` bars meets `right` of `rightBars`, at `atBar`. */
const seam = (
  index: number,
  right: number,
  atBar: number,
  bars: [number, number],
  px = PX,
): LaneSeam => ({
  index,
  right,
  px: atBar * px,
  leftWidthPx: bars[0] * px,
  rightWidthPx: bars[1] * px,
});
/** Two touching blocks of four bars at 96 px a bar, then a gap and a third. */
const LANE: LaneGeometry = {
  boxes: [box(0, 4 * BAR, 0), box(4 * BAR, 4 * BAR, 1), box(10 * BAR, 2 * BAR, 2)],
  seams: [seam(0, 1, 4, [4, 4])],
  edges: true,
};

describe('hit testing', () => {
  it('takes a seam first, ±6 px around it, then the edge zones, then the body', () => {
    const seam = 4 * PX;
    expect(laneHitAt(LANE, seam - LANE_EDIT.seamHitPx)).toEqual({ kind: 'seam', index: 0 });
    expect(laneHitAt(LANE, seam + LANE_EDIT.seamHitPx)).toEqual({ kind: 'seam', index: 0 });
    expect(laneHitAt(LANE, seam + LANE_EDIT.seamHitPx + 1)).toEqual({ kind: 'start', index: 1 });
    expect(laneHitAt(LANE, 2 * PX)).toEqual({ kind: 'body', index: 0 });
    expect(laneHitAt(LANE, 12 * PX - BLOCK_GAP_PX - 1)).toEqual({ kind: 'end', index: 2 });
    expect(laneHitAt(LANE, 9 * PX)).toEqual({ kind: 'gap' });
  });

  it('reports the index a block carries, not its place in the lane', () => {
    const wrapped = { ...LANE, boxes: [box(0, BAR, 3), box(BAR, 3 * BAR, 0)], seams: [] };
    expect(laneHitAt(wrapped, 2 * PX)).toEqual({ kind: 'body', index: 0 });
    expect(laneHitAt(wrapped, PX / 2)).toEqual({ kind: 'body', index: 3 });
  });

  it('picks the nearest seam where two zones overlap, not the first', () => {
    const px = 8;
    const wide = { ...LANE_EDIT, seamFraction: 1 };
    const lane: LaneGeometry = {
      boxes: [box(0, BAR, 0, px), box(BAR, BAR, 1, px), box(2 * BAR, BAR, 2, px)],
      seams: [seam(0, 1, 1, [1, 1], px), seam(1, 2, 2, [1, 1], px)],
      edges: false,
    };
    expect(laneHitAt(lane, 2 * px - 3, wide)).toEqual({ kind: 'seam', index: 1 });
    expect(laneHitAt(lane, px + 3, wide)).toEqual({ kind: 'seam', index: 0 });
  });

  it('caps a seam’s zone at a third of either neighbour, so a short block keeps a body', () => {
    expect(seamZonePx(seam(0, 1, 4, [4, 4]))).toBe(LANE_EDIT.seamHitPx);
    const px = 8;
    const short = seam(0, 1, 1, [1, 1], px);
    expect(seamZonePx(short)).toBe(px / 3);
    const lane: LaneGeometry = {
      boxes: [box(0, BAR, 0, px), box(BAR, BAR, 1, px)],
      seams: [short],
      edges: false,
    };
    expect(laneHitAt(lane, px + 3)).toEqual({ kind: 'body', index: 1 });
    expect(laneHitAt(lane, px - 3)).toEqual({ kind: 'body', index: 0 });
    expect(laneHitAt(lane, px)).toEqual({ kind: 'seam', index: 0 });
  });

  it("has no edge zones on a lane whose blocks have none (the harmony track's)", () => {
    const harmony = { ...LANE, edges: false };
    expect(laneHitAt(harmony, 10 * PX + 1)).toEqual({ kind: 'body', index: 2 });
  });

  it('shrinks the edge zone to a third of a narrow block, at the narrowest zoom', () => {
    expect(edgeZonePx(100)).toBe(LANE_EDIT.edgeMaxPx);
    expect(edgeZonePx(MIN_BLOCK_PX)).toBe(MIN_BLOCK_PX / 3);
    const beat = { boxes: [box(BAR, PPQ, 0, 8)], seams: [], edges: true };
    const left = beat.boxes[0]?.leftPx ?? 0;
    expect(laneHitAt(beat, left + 1).kind).toBe('start');
    expect(laneHitAt(beat, left + MIN_BLOCK_PX / 2).kind).toBe('body');
    expect(laneHitAt(beat, left + MIN_BLOCK_PX).kind).toBe('end');
  });
});

describe('a seam drag', () => {
  it('moves the boundary by the pointer’s travel, keeping the grab offset', () => {
    // Pressed 30 ticks right of a seam at bar 4, then moved a bar: the seam lands on bar 5, not bar 5 + 30.
    expect(draggedBoundary(4 * TICKS_PER_BAR, 4 * TICKS_PER_BAR + 30, 5 * TICKS_PER_BAR + 30)).toBe(
      5 * TICKS_PER_BAR,
    );
  });
});

describe('the cursor', () => {
  it("is col-resize on a seam, a resize arrow on an edge, and the lane's own on a body", () => {
    expect(laneCursor('harmony', { kind: 'seam', index: 0 }, false)).toBe('col-resize');
    expect(laneCursor('harmony', { kind: 'body', index: 0 }, false)).toBe('pointer');
    expect(laneCursor('harmony', { kind: 'gap' }, false)).toBe('');
    expect(laneCursor('part', { kind: 'end', index: 0 }, false)).toBe('ew-resize');
    expect(laneCursor('part', { kind: 'body', index: 0 }, true)).toBe('grabbing');
    expect(laneCursor('part', { kind: 'gap' }, false)).toBe('crosshair');
  });
});

describe('the seam marks', () => {
  it('light the active seam and show the selected block’s two faintly', () => {
    const seams = [0, 1, 2].map((index) => ({ index, right: index + 1 }));
    expect(seamMarks(seams, 1, null)).toEqual([
      { index: 0, faint: true },
      { index: 1, faint: true },
    ]);
    expect(seamMarks(seams, 1, 1)).toEqual([
      { index: 0, faint: true },
      { index: 1, faint: false },
    ]);
    expect(seamMarks(seams, null, 2)).toEqual([{ index: 2, faint: false }]);
    expect(seamMarks([], 0, null)).toEqual([]);
  });

  it('show a seam faint by the item on its right, not by index + 1 (the harmony wrap)', () => {
    expect(seamMarks([{ index: 2, right: 0 }], 0, null)).toEqual([{ index: 2, faint: true }]);
  });
});

describe('the readout', () => {
  it('reads bar.beat, with the sixteenth only off the beat', () => {
    expect(readoutPosition(0)).toBe('1.1');
    expect(readoutPosition(2 * BAR + PPQ)).toBe('3.2');
    expect(readoutPosition(2 * BAR + PPQ + PPQ / 4)).toBe('3.2.2');
    expect(readoutPosition(84 + 48, '7/8')).toBe('2.3');
  });

  it('reads lengths in bars, beats and steps of the song’s meter', () => {
    expect(lengthLabel(BAR)).toBe('1 bar');
    expect(lengthLabel(2 * BAR + PPQ)).toBe('2 bars 1 beat');
    expect(lengthLabel(3 * PPQ)).toBe('3 beats');
    expect(lengthLabel(PPQ + PPQ / 4)).toBe('1 beat 1 step');
    expect(lengthLabel(0)).toBe('0');
    expect(lengthLabel(72, '6/8')).toBe('1 bar');
  });

  it('reads a seam as its place and the two lengths, and a block as start → end · length', () => {
    expect(seamReadout(8 * BAR, 8 * BAR, 8 * BAR, FOUR_FOUR)).toBe('9.1 · 8 bars | 8 bars');
    expect(seamReadout(BAR + PPQ, BAR + PPQ, 3 * BAR - PPQ)).toBe(
      '2.2 · 1 bar 1 beat | 2 bars 3 beats',
    );
    expect(spanReadout(4 * BAR, 8 * BAR)).toBe('5.1 → 9.1 · 4 bars');
  });
});

/**
 * The lane edits (windsor#349 decisions 2–5): snap, where a press lands, add,
 * move between neighbours, bend with its snap to straight, straighten,
 * delete down to one point, Draw's range replacement on the grain, and one
 * undo step per gesture through the context.
 */
import { describe, expect, it } from 'vitest';
import {
  PPQ,
  TICKS_PER_BAR,
  catalogRow,
  toDisplay,
  valueAt,
  type AutomationPoint,
  type DocumentPartial,
  type ApplyResult,
} from '@windsor/engine';
import { AUTOMATION_DOCUMENT, AUTOMATION_PART } from '@windsor/engine/__fixtures__/automationSong';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { DocumentModel } from './documentModel';
import { withGesture } from './gestureHooks';
import type { EngineHost } from './host';
import { laneY } from './songAutomationCurve';
import {
  addPoint,
  addPointOnLine,
  deletePoint,
  displayAtPx,
  draggedBend,
  drawGrain,
  movePoint,
  pressAt,
  segmentAt,
  snapTick,
  strokePoints,
  strokeTo,
  tickAtPx,
  valueAtPx,
  withBend,
  withPoints,
  type LaneFrame,
} from './songAutomationEdit';
import { automationChange, lanesOf } from './songAutomationModel';
import { AUTOMATION_GESTURES, SNAP_CHOICES } from './songAutomationTables';

const BAR = TICKS_PER_BAR;
const SIXTEENTH = PPQ / 4;
const H = 56;
const frame: LaneFrame = { pxPerBar: 96, heightPx: H, songTicks: 4 * BAR };
const pan = catalogRow('strip.pan')!;
const level = catalogRow('strip.level')!;
const P = (tick: number, value: number, bend = 0): AutomationPoint => ({ tick, value, bend });
/** Pan from hard left at bar 1 to hard right at bar 3, then held. */
const ramp: AutomationPoint[] = [P(0, -1), P(2 * BAR, 1), P(3 * BAR, 1)];
const yOf = (value: number): number => laneY(toDisplay(pan, value), H);

describe('snap', () => {
  it('lands on the grain, inside the song', () => {
    expect(snapTick(13, SIXTEENTH, 4 * BAR)).toBe(12);
    expect(snapTick(50, BAR, 4 * BAR)).toBe(BAR);
    expect(snapTick(-5, SIXTEENTH, 4 * BAR)).toBe(0);
    expect(snapTick(4 * BAR + 9, SIXTEENTH, 4 * BAR)).toBe(4 * BAR);
  });

  it('takes the nearest whole tick with Shift or Snap Off', () => {
    expect(snapTick(13.4, SIXTEENTH, 4 * BAR, true)).toBe(13);
    expect(snapTick(13.6, 0, 4 * BAR)).toBe(14);
  });

  it('offers Bar to Off, and Draw falls back to 1/32 under Off', () => {
    expect(SNAP_CHOICES.map((c) => c.label)).toEqual(['Bar', '1/4', '1/8', '1/16', '1/32', 'Off']);
    expect(SNAP_CHOICES.find((c) => c.label === 'Off')?.ticks).toBe(0);
    expect(drawGrain(0)).toBe(PPQ / 8);
    expect(drawGrain(SIXTEENTH)).toBe(SIXTEENTH);
  });

  it('maps px to ticks and heights both ways', () => {
    expect(tickAtPx(48, frame)).toBe(BAR / 2);
    expect(tickAtPx(-10, frame)).toBe(0);
    expect(displayAtPx(laneY(0.25, H), frame)).toBeCloseTo(0.25, 12);
    expect(valueAtPx(pan, yOf(0.5), frame)).toBeCloseTo(0.5, 12);
  });
});

describe('where a press lands', () => {
  it('on a point within reach, the nearest', () => {
    const x = 2 * 96;
    expect(pressAt(pan, ramp, frame, { x: x + 3, y: yOf(1) + 2 })).toEqual({
      kind: 'point',
      index: 1,
    });
  });

  it('on the line within 10 px, with the segment under it', () => {
    const x = 96; // bar 2, half way up the ramp
    const y = yOf(valueAt(pan, ramp, BAR));
    expect(pressAt(pan, ramp, frame, { x, y: y + 9 })).toEqual({
      kind: 'space',
      near: true,
      segment: 0,
    });
    expect(pressAt(pan, ramp, frame, { x, y: y + 11 })).toEqual({
      kind: 'space',
      near: false,
      segment: 0,
    });
  });

  it('past the last point the line holds and no segment is under it', () => {
    expect(pressAt(pan, ramp, frame, { x: 3.5 * 96, y: yOf(1) })).toEqual({
      kind: 'space',
      near: true,
      segment: null,
    });
    expect(segmentAt(ramp, 2 * BAR)).toBe(1);
    expect(segmentAt(ramp, -1)).toBeNull();
  });

  it('a step has no segment of its own', () => {
    const step = [P(0, 0), P(BAR, 0), P(BAR, 1), P(2 * BAR, 1)];
    expect(segmentAt(step, BAR)).toBe(2);
  });
});

describe('the Edit gestures', () => {
  it('adds a point in tick order, carrying the bend of the segment it splits', () => {
    const bent = withBend(ramp, 0, 0.5);
    const { points, index } = addPoint(bent, BAR, 0.2)!;
    expect(index).toBe(1);
    expect(points).toEqual([P(0, -1, 0.5), P(BAR, 0.2, 0.5), P(2 * BAR, 1), P(3 * BAR, 1)]);
    expect(addPoint(ramp, 4 * BAR, 0)!.index).toBe(3);
  });

  it('adds a point on the line at the line value', () => {
    const tick = snapTick(tickAtPx(96, frame), SIXTEENTH, frame.songTicks);
    const { points } = addPointOnLine(pan, ramp, tick)!;
    expect(points[1]).toEqual(P(BAR, 0));
    // The curve through it is unchanged.
    for (const t of [0, BAR / 2, BAR, 1.5 * BAR, 2 * BAR]) {
      expect(valueAt(pan, points, t)).toBeCloseTo(valueAt(pan, ramp, t), 12);
    }
  });

  it('adds a point on a bent line without moving the curve', () => {
    const lane = AUTOMATION_PART.automation!.find((l) => l.target === 'voice.filter.cutoff')!;
    const cutoff = catalogRow('voice.filter.cutoff')!;
    const original = lane.points;
    const shown = (points: readonly AutomationPoint[], t: number): number =>
      toDisplay(cutoff, valueAt(cutoff, points, t));
    for (const [segment, s] of [
      [0, 0.3],
      [1, 0.5],
      [0, 0.7],
    ] as const) {
      const a = original[segment]!;
      const b = original[segment + 1]!;
      const tick = Math.round(a.tick + s * (b.tick - a.tick));
      const { points, index } = addPointOnLine(cutoff, original, tick)!;
      expect(points[index - 1]!.bend).toBe(a.bend);
      // The left half is the same curve exactly.
      for (let i = 0; i <= 16; i++) {
        const t = a.tick + ((tick - a.tick) * i) / 16;
        expect(shown(points, t)).toBeCloseTo(shown(original, t), 9);
      }
      // The right half is the nearest one segment can be (songAutomationSplit.test.ts).
      for (let i = 0; i <= 16; i++) {
        const t = tick + ((b.tick - tick) * i) / 16;
        expect(Math.abs(shown(points, t) - shown(original, t))).toBeLessThan(0.005);
      }
    }
  });

  it('a click off the line keeps the bend of the segment it splits', () => {
    const bent = withBend(ramp, 0, 0.5);
    expect(addPoint(bent, BAR, 0.9)!.points[1]!.bend).toBe(0.5);
  });

  it('adds nothing on a tick that already holds two points', () => {
    const step = [P(0, 0), P(BAR, 0), P(BAR, 1), P(2 * BAR, 1)];
    expect(addPoint(step, BAR, 0.5)).toBeNull();
    expect(addPointOnLine(pan, step, BAR)).toBeNull();
    expect(addPoint(step, 0, 0.5)!.points).toHaveLength(5);
  });

  it('moves a point onto a lone neighbour tick, but never onto a step', () => {
    const lane = AUTOMATION_PART.automation!.find((l) => l.target === 'voice.ops.0.level')!;
    const moved = movePoint(lane.points, 0, { tick: 2 * BAR, value: 0.5 });
    expect(moved[0]).toEqual(P(2 * BAR - 1, 0.5));
    const step = [P(0, 0), P(BAR, 0), P(BAR, 1), P(2 * BAR, 1), P(3 * BAR, 0)];
    expect(movePoint(step, 3, { tick: 0, value: 1 })[3]!.tick).toBe(BAR + 1);
    // Either side of the step moves along its own neighbour tick freely.
    expect(movePoint(step, 2, { tick: 0, value: 1 })[2]!.tick).toBe(BAR);
    expect(movePoint(step, 1, { tick: 3 * BAR, value: 0 })[1]!.tick).toBe(BAR);
    // A lone neighbour tick is inclusive: the point may make a step there.
    expect(movePoint(step, 3, { tick: 4 * BAR, value: 1 })[3]!.tick).toBe(3 * BAR);
  });

  it('moves a point, clamped between its neighbours', () => {
    expect(movePoint(ramp, 1, { tick: BAR, value: 0 })[1]).toEqual(P(BAR, 0));
    expect(movePoint(ramp, 1, { tick: 3.5 * BAR, value: 0 })[1]).toEqual(P(3 * BAR, 0));
    expect(movePoint(ramp, 1, { tick: -BAR, value: 0 })[1]).toEqual(P(0, 0));
    expect(movePoint(ramp, 0, { tick: 2, value: -0.5 })[0]).toEqual(P(2, -0.5));
  });

  it('bends one full unit per 45 px of drag, up bowing up, clamped', () => {
    const px = AUTOMATION_GESTURES.bendPxPerUnit;
    expect(px).toBe(45);
    expect(draggedBend(0, -px / 2)).toBeCloseTo(0.5, 12);
    expect(draggedBend(0, px / 2)).toBeCloseTo(-0.5, 12);
    expect(draggedBend(0, -3 * px)).toBe(1);
    expect(draggedBend(0.5, 3 * px)).toBe(-1);
    const bowed = withBend(ramp, 0, draggedBend(0, -px / 2));
    expect(valueAt(pan, bowed, BAR)).toBeGreaterThan(valueAt(pan, ramp, BAR));
  });

  it('snaps to straight within ±0.07', () => {
    const px = AUTOMATION_GESTURES.bendPxPerUnit;
    expect(draggedBend(0, -0.06 * px)).toBe(0);
    expect(draggedBend(0, 0.06 * px)).toBe(0);
    expect(draggedBend(0, -0.08 * px)).toBeCloseTo(0.08, 12);
    expect(draggedBend(0.3, 0.27 * px)).toBe(0);
  });

  it('straightens a bent segment and leaves the rest', () => {
    const bent = withBend(withBend(ramp, 0, 0.6), 1, -0.4);
    expect(withBend(bent, 0, 0)).toEqual([P(0, -1), P(2 * BAR, 1, -0.4), P(3 * BAR, 1)]);
  });

  it('deletes a point, down to one and no further', () => {
    expect(deletePoint(ramp, 1)).toEqual([P(0, -1), P(3 * BAR, 1)]);
    const one = [P(BAR, 0.3)];
    expect(deletePoint(one, 0)).toEqual(one);
  });
});

describe('Draw', () => {
  const grain = { ticks: SIXTEENTH, songTicks: 4 * BAR };

  it('writes the grain ticks between two positions, on the line joining them', () => {
    const samples = new Map<number, number>();
    strokeTo(samples, null, { tick: BAR, display: 0 }, grain);
    strokeTo(samples, { tick: BAR, display: 0 }, { tick: BAR + 4 * SIXTEENTH, display: 1 }, grain);
    expect([...samples.keys()]).toEqual([0, 1, 2, 3, 4].map((i) => BAR + i * SIXTEENTH));
    expect([...samples.values()]).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('draws backwards too, and a tick drawn again takes the newer height', () => {
    const samples = new Map<number, number>();
    strokeTo(samples, null, { tick: BAR, display: 0.2 }, grain);
    strokeTo(
      samples,
      { tick: BAR, display: 0.2 },
      { tick: BAR - 2 * SIXTEENTH, display: 0.8 },
      grain,
    );
    expect([...samples.keys()].sort((a, b) => a - b)).toEqual([
      BAR - 2 * SIXTEENTH,
      BAR - SIXTEENTH,
      BAR,
    ]);
    strokeTo(
      samples,
      { tick: BAR - 2 * SIXTEENTH, display: 0.8 },
      { tick: BAR, display: 0.6 },
      grain,
    );
    expect(samples.get(BAR)).toBe(0.6);
  });

  it('a slow vertical move inside one cell stores the newest height', () => {
    const samples = new Map<number, number>();
    strokeTo(samples, null, { tick: BAR, display: 0.2 }, grain);
    strokeTo(samples, { tick: BAR, display: 0.2 }, { tick: BAR, display: 0.5 }, grain);
    strokeTo(samples, { tick: BAR, display: 0.5 }, { tick: BAR + 1, display: 0.9 }, grain);
    expect([...samples]).toEqual([[BAR, 0.9]]);
  });

  it('a diagonal move inside one cell stores the newest height', () => {
    const samples = new Map<number, number>();
    // 13 and 14 both snap to 12 on a 6-tick grain.
    strokeTo(samples, null, { tick: BAR + 13, display: 0 }, grain);
    strokeTo(samples, { tick: BAR + 13, display: 0 }, { tick: BAR + 14, display: 1 }, grain);
    expect([...samples]).toEqual([[BAR + 2 * SIXTEENTH, 1]]);
  });

  it('replaces only the range drawn, on the grain, and keeps the points outside', () => {
    const samples = new Map<number, number>([
      [BAR, 0.5],
      [BAR + SIXTEENTH, 0.75],
      [BAR + 2 * SIXTEENTH, 1],
    ]);
    const original = [P(0, -1), P(BAR + SIXTEENTH, 0), P(2 * BAR, 1, 0.3), P(3 * BAR, 1)];
    const drawn = strokePoints(pan, original, samples);
    expect(drawn).toEqual([
      P(0, -1),
      P(BAR, 0),
      P(BAR + SIXTEENTH, 0.5),
      P(BAR + 2 * SIXTEENTH, 1),
      P(2 * BAR, 1, 0.3),
      P(3 * BAR, 1),
    ]);
    expect(drawn.every((p) => p.tick % SIXTEENTH === 0)).toBe(true);
  });

  it('draws in the knob scale: a mid-height stroke on the level lane is the mid dB', () => {
    const drawn = strokePoints(level, [P(0, 1)], new Map([[BAR, 0.5]]));
    expect(toDisplay(level, drawn[1]!.value)).toBeCloseTo(0.5, 12);
  });
});

describe('one gesture, one undo step', () => {
  const slot = AUTOMATION_PART.slot;
  const lanes = lanesOf(AUTOMATION_PART);
  const target = lanes[0]!.target;

  function openConsole(): { ctx: AppContext<TabPanel>; model: DocumentModel } {
    const model = new DocumentModel(AUTOMATION_DOCUMENT);
    const host: ContextHost = {
      apply: (_partial: DocumentPartial): ApplyResult => ({ ok: true, ignored: [] }),
      build: () => Promise.resolve(),
      isBuilding: false,
      capturePattern: () => null,
      part: () => null,
    };
    const ctx = new AppContext<TabPanel>({
      host: { ...host, transport: { position: () => 0 } } as unknown as EngineHost,
      model,
      notify: () => undefined,
    });
    ctx.addTab('song', { hidden: false }, () => {});
    return { ctx, model };
  }
  const pointsIn = (model: DocumentModel): readonly AutomationPoint[] | undefined =>
    model.doc.parts.find((p) => p.slot === slot)?.automation?.find((l) => l.target === target)
      ?.points;

  it('commits the whole list once, and undo restores the exact previous points', () => {
    const { ctx, model } = openConsole();
    const before = pointsIn(model)!;
    const after = deletePoint(addPoint(before, BAR + 7, 0.123)!.points, 0);
    withGesture('Move Level point', () => {
      ctx.change(automationChange(slot, withPoints(lanesOf(AUTOMATION_PART), target, after)));
    });
    expect(pointsIn(model)).toEqual(after);
    expect(ctx.undo()).toBe(true);
    expect(pointsIn(model)).toStrictEqual(before);
    expect(ctx.canUndo).toBe(false);
  });
});

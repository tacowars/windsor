/**
 * The Song tab's Edit, Draw and Shape over a roll's loop (windsor#708
 * decisions 2 and 5): the gestures' own rules on the roll's host, settled
 * to what an envelope holds. A click lands on the roll's Snap, a drag is
 * held inside the loop, a Draw stroke on a triplet Snap lands on the
 * triplet grid, a Shape press on the loop's edge takes the last full bar,
 * and every point written is heard: one to a tick and inside the loop.
 */
import { describe, expect, it } from 'vitest';

import type { RollEnvelopePoint } from '@windsor/engine';
import {
  PPQ,
  ROLL_ENVELOPE_POINTS_MAX,
  ROLL_ENVELOPE_ROW,
  ROLL_LOOP_TICKS_MAX,
  TICKS_PER_BAR,
  envelopeValueAt,
} from '@windsor/engine';
import { hostBarTicks, hostFrame } from './automationEditHost';
import { rollEnvelopeHost } from './rollEnvelopeHost';
import {
  FLAT_POINT,
  editablePoints,
  envelopeUndoLabel,
  settlePoints,
  withinPointCap,
} from './rollEnvelopeSettle';
import { defaultRollView } from './rollView';
import { drawGrain, snapTick, tickAtPx, withBend } from './songAutomationEdit';
import { laneEdits } from './songAutomationRules';
import { shapeRange, shapedPoints, stampedPoints } from './songShapeModel';
import { shapeLanePoints } from './songShapeRange';
import { shapeRates } from './songShapeTables';

const BAR = TICKS_PER_BAR;
const LOOP = 2 * BAR;
const PX_PER_TICK = 2;
/** The roll's Snap at 1/16T: four ticks. */
const TRIPLET = 4;
const SNAP_TRIPLET = 4;

/** A 2-bar loop in a 4-bar region on the 1/16T Snap, the Draw tool or `tool`. */
function rollHost(tool: 'edit' | 'draw' | 'shape' = 'edit') {
  const view = defaultRollView();
  view.snap = SNAP_TRIPLET;
  view.envelope.tool = tool;
  return rollEnvelopeHost(view, () => ({
    pxPerTick: PX_PER_TICK,
    loopTicks: LOOP,
    regionTicks: 2 * LOOP,
    heightPx: 112,
    meter: undefined,
  }));
}

const P = (tick: number, value: number, bend = 0): RollEnvelopePoint => ({ tick, value, bend });
const edits = laneEdits(ROLL_ENVELOPE_ROW);

describe('an envelope under the Edit tool', () => {
  const start = [P(0, -0.5), P(BAR, 0.5), P(3 * BAR, 1)];
  const settle = (next: readonly RollEnvelopePoint[]) =>
    settlePoints(next, { start, loopTicks: LOOP, stroke: false });

  it('edits the flat 0 line when no point is heard, and keeps the silent ones', () => {
    expect(editablePoints([], LOOP)).toEqual([FLAT_POINT]);
    expect(editablePoints([P(3 * BAR, 1)], LOOP)).toEqual([FLAT_POINT, P(3 * BAR, 1)]);
    expect(editablePoints(start, LOOP)).toBe(start);
  });

  it("adds a click's point on the roll's Snap, or on any tick with Shift", () => {
    const host = rollHost();
    const tick = tickAtPx(41 * PX_PER_TICK, hostFrame(host));
    expect(snapTick(tick, host.tools.automationSnap, host.axisTicks())).toBe(40);
    expect(snapTick(tick, host.tools.automationSnap, host.axisTicks(), true)).toBe(41);
    const added = edits.add(start, { tick: 40, value: 0.25, onLine: false })!;
    expect(settle(added)).toEqual([P(0, -0.5), P(40, 0.25), P(BAR, 0.5), P(3 * BAR, 1)]);
  });

  it('moves a point dragged past the loop to its last tick, where it is heard', () => {
    const host = rollHost();
    const to = snapTick(tickAtPx(10 * LOOP, hostFrame(host)), TRIPLET, host.axisTicks());
    expect(to).toBe(LOOP);
    const moved = settle(edits.move(start, 1, { tick: to, value: 0.75 }));
    expect(moved[1]).toEqual(P(LOOP - 1, 0.75));
    expect(
      envelopeValueAt({ target: 'filter.cutoff', on: true, points: moved }, LOOP - 1, LOOP),
    ).toBe(0.75);
    expect(moved[2]).toBe(start[2]);
  });

  it("stops a point dragged onto a neighbour's tick one tick short of it", () => {
    expect(settle(edits.move(start, 1, { tick: 0, value: 0 }))[1]).toEqual(P(1, 0));
  });

  it('keeps one point to a tick: a click on a point’s tick replaces it', () => {
    const added = edits.add(start, { tick: BAR, value: -1, onLine: false })!;
    expect(settle(added)).toEqual([P(0, -0.5), P(BAR, -1), P(3 * BAR, 1)]);
  });

  it('bends and straightens a segment as the Song tab does', () => {
    const bent = settle(withBend(start, 0, 0.5));
    expect(bent[0]).toEqual(P(0, -0.5, 0.5));
    expect(settle(withBend(bent, 0, 0))[0]).toEqual(P(0, -0.5));
  });

  it('deletes a point on a double-click', () => {
    expect(settle(edits.remove(start, 1))).toEqual([P(0, -0.5), P(3 * BAR, 1)]);
  });
});

describe('a Draw stroke across the loop on a triplet Snap', () => {
  it('lands every point on the triplet grid, inside the loop', () => {
    const host = rollHost('draw');
    const grain = { ticks: drawGrain(host.tools.automationSnap), axisTicks: host.axisTicks() };
    const samples = new Map<number, number>();
    const from = { tick: 0, display: 0 };
    edits.stroke(samples, null, from, grain);
    edits.stroke(samples, from, { tick: 3 * LOOP, display: 1 }, grain);
    const start = editablePoints([], LOOP);
    const drawn = settlePoints(edits.drawn(start, samples, grain), {
      start,
      loopTicks: LOOP,
      stroke: true,
    });
    expect(drawn.every((p) => p.tick % TRIPLET === 0)).toBe(true);
    expect(drawn.at(-1)?.tick).toBe(LOOP - TRIPLET);
    expect(drawn).toHaveLength(LOOP / TRIPLET);
  });
});

describe('a Shape range on the loop', () => {
  it("takes the last full bar for a press at the loop's right edge, and ends heard", () => {
    const host = rollHost('shape');
    const press = { pressTick: LOOP, fromTick: LOOP, toTick: LOOP, dragged: false };
    const range = shapeRange(press, host.axisTicks(), hostBarTicks(host));
    expect(range).toEqual({ startTick: BAR, endTick: LOOP });
    const draft = { kind: 'ramp', rateTicks: BAR, top: 1, bottom: 0, phase: 0, duty: 0.5 } as const;
    const stamp = stampedPoints(ROLL_ENVELOPE_ROW, range, draft);
    const start = editablePoints([], LOOP);
    const shaped = shapedPoints(start, range, stamp);
    const next = settlePoints(shaped, { start, loopTicks: LOOP, stroke: false });
    expect(next.at(-1)).toMatchObject({ tick: LOOP - 1, value: 1 });
    const envelope = { target: 'filter.cutoff' as const, on: true, points: next };
    expect(envelopeValueAt(envelope, LOOP - 2, LOOP)).toBeGreaterThan(0.95);
  });
});

describe('the undo steps', () => {
  it('names Draw for the envelope and keeps the Edit tool’s words', () => {
    expect(envelopeUndoLabel('Draw Cutoff', 'Cutoff')).toBe('Draw Cutoff envelope');
    expect(envelopeUndoLabel('Move Cutoff point', 'Cutoff')).toBe('Move Cutoff point');
    expect(envelopeUndoLabel('Bend Cutoff line', 'Cutoff')).toBe('Bend Cutoff line');
  });
});

describe('a gesture past the point cap on the longest loop', () => {
  const LONGEST = ROLL_LOOP_TICKS_MAX;
  const outside = [P(0, -0.5), P(BAR, 0.5), P(LONGEST - BAR / 2, 1)];
  const from = 2 * BAR;
  const to = LONGEST - BAR;

  /** Fits the cap, keeps every found point, rises; the first and last ticks the gesture's own points span. */
  function fitted(next: readonly RollEnvelopePoint[]) {
    expect(next.length).toBeLessThanOrEqual(ROLL_ENVELOPE_POINTS_MAX);
    for (const point of outside) expect(next).toContain(point);
    const ticks = next.map((p) => p.tick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    const written = next.filter((point) => !outside.includes(point));
    return { first: written[0]?.tick, last: written.at(-1)?.tick };
  }

  it('thins a 1/32 Draw stroke evenly across its whole range', () => {
    const grain = { ticks: drawGrain(PPQ / 8), axisTicks: LONGEST };
    const samples = new Map<number, number>();
    const a = { tick: from, display: 0 };
    edits.stroke(samples, null, a, grain);
    edits.stroke(samples, a, { tick: to, display: 1 }, grain);
    const drawn = edits.drawn(outside, samples, grain);
    expect(drawn.length).toBeGreaterThan(ROLL_ENVELOPE_POINTS_MAX);
    const next = settlePoints(drawn, { start: outside, loopTicks: LONGEST, stroke: true });
    expect(fitted(next)).toEqual({ first: from, last: to });
  });

  it('thins a Shape at the shortest rate evenly across its whole range', () => {
    const range = { startTick: from, endTick: to };
    const rateTicks = shapeRates()[0]!.ticks;
    const draft = { kind: 'square', rateTicks, top: 1, bottom: 0, phase: 0, duty: 0.5 } as const;
    const shaped = shapedPoints(outside, range, stampedPoints(ROLL_ENVELOPE_ROW, range, draft));
    expect(shaped.length).toBeGreaterThan(ROLL_ENVELOPE_POINTS_MAX);
    const stamp = shaped.filter((p) => !outside.includes(p));
    const next = settlePoints(shaped, { start: outside, loopTicks: LONGEST, stroke: false });
    expect(fitted(next)).toEqual({ first: stamp[0]?.tick, last: stamp.at(-1)?.tick });
    expect(stamp[0]?.tick).toBe(from);
  });

  it('keeps a result under the cap whole, and the first and last of one over it', () => {
    const next = [P(0, 0), P(1, 1)];
    expect(withinPointCap(next, [], 2)).toEqual(next);
    const over = [...next, P(2, 0), P(3, 1), P(4, 0)];
    expect(withinPointCap(over, [], 3).map((p) => p.tick)).toEqual([0, 2, 4]);
  });
});

describe('the Shape preview on a roll', () => {
  it('draws exactly what Apply writes for a range ending on the loop’s last tick', () => {
    const range = { startTick: BAR, endTick: LOOP };
    const draft = {
      kind: 'sine',
      rateTicks: BAR / 4,
      top: 1,
      bottom: 0,
      phase: 0,
      duty: 0.5,
    } as const;
    let start: readonly RollEnvelopePoint[] = [];
    const lane = {
      row: ROLL_ENVELOPE_ROW,
      points: () => (start = editablePoints([], LOOP)),
      settle: (next: readonly RollEnvelopePoint[]) =>
        settlePoints(next, { start, loopTicks: LOOP, stroke: false }),
    };
    const preview = shapeLanePoints(lane, range, draft);
    const committed = shapeLanePoints(lane, range, draft);
    expect(preview).toEqual(committed);
    expect(preview.at(-1)?.tick).toBe(LOOP - 1);
    expect(preview.every((p) => p.tick < LOOP)).toBe(true);
  });
});

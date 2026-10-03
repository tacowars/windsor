import { describe, expect, it } from 'vitest';
import { fromDisplay, toDisplay } from './automationDisplay';
import { bendCurve, rampsBetween, valueAt } from './automationEvaluate';
import type { AutomationPoint, AutomationTargetRow } from './automationLane';
import { requireCatalogRow, voiceTargetId } from './automationTargets';

const PAN = requireCatalogRow('strip.pan');
const LEVEL = requireCatalogRow('strip.level');
const CUTOFF = requireCatalogRow(voiceTargetId('filter.cutoff'));

const p = (tick: number, value: number, bend = 0): AutomationPoint => ({ tick, value, bend });

/** The straight line in display space between two points, as the row's value. */
function linear(
  row: AutomationTargetRow,
  a: AutomationPoint,
  b: AutomationPoint,
  tick: number,
): number {
  const ya = toDisplay(row, a.value);
  const yb = toDisplay(row, b.value);
  const u = (tick - a.tick) / (b.tick - a.tick);
  return fromDisplay(row, ya + (yb - ya) * u);
}

describe('valueAt', () => {
  it('holds a single point everywhere', () => {
    const points = [p(48, 0.25)];
    for (const tick of [-10, 0, 48, 49.5, 1e6]) expect(valueAt(PAN, points, tick)).toBe(0.25);
  });

  it('holds the first value before the first point and the last after the last', () => {
    const points = [p(24, -0.5), p(48, 0.5), p(96, 0.75)];
    expect(valueAt(PAN, points, 0)).toBe(-0.5);
    expect(valueAt(PAN, points, 23.999)).toBe(-0.5);
    expect(valueAt(PAN, points, 96)).toBe(0.75);
    expect(valueAt(PAN, points, 500)).toBe(0.75);
  });

  it('takes the later point exactly at a step, and each side just beside it', () => {
    const points = [p(0, -1), p(24, 0), p(24, 1), p(48, 1)];
    expect(valueAt(PAN, points, 24)).toBe(1);
    expect(valueAt(PAN, points, 24 - 1e-9)).toBeCloseTo(0, 6);
    expect(valueAt(PAN, points, 24 + 1e-9)).toBe(1);
    const first = [p(10, -1), p(10, 1), p(20, 0)];
    expect(valueAt(PAN, first, 10)).toBe(1);
    expect(valueAt(PAN, first, 9)).toBe(-1);
  });

  it('is the straight line bit for bit at bend 0, on every scale', () => {
    for (const [row, a, b] of [
      [PAN, p(0, -1), p(96, 1)],
      [LEVEL, p(0, 0.01), p(96, 2)],
      [CUTOFF, p(0, 18000), p(96, 60)],
    ] as const) {
      for (let tick = 0.75; tick < 96; tick += 0.75) {
        expect(valueAt(row, [a, b], tick)).toBe(linear(row, a, b, tick));
      }
      expect(valueAt(row, [a, b], 0)).toBe(a.value);
      expect(valueAt(row, [a, b], 96)).toBe(b.value);
    }
  });

  it('bows a +1 bend up and a −1 bend down, rising or falling, with the ends exact', () => {
    const mid = 12;
    for (const [from, to] of [
      [-1, 1],
      [1, -1],
    ]) {
      for (const bend of [1, -1]) {
        const a = p(0, from!, bend);
        const b = p(24, to!);
        const line = linear(PAN, a, b, mid);
        const curved = valueAt(PAN, [a, b], mid);
        if (bend > 0) expect(curved).toBeGreaterThan(line);
        else expect(curved).toBeLessThan(line);
        expect(valueAt(PAN, [a, b], 0)).toBe(from);
        expect(valueAt(PAN, [a, b], 24)).toBe(to);
      }
    }
  });

  it('follows u^(5^∓bend) in display space', () => {
    const a = p(0, -1, 1);
    const b = p(10, 1);
    expect(valueAt(PAN, [a, b], 5)).toBeCloseTo(-1 + 2 * 0.5 ** (1 / 5), 12);
    expect(valueAt(PAN, [{ ...a, bend: -1 }, b], 5)).toBeCloseTo(-1 + 2 * 0.5 ** 5, 12);
  });

  it('keeps a flat bent segment flat', () => {
    const points = [p(0, 0.3, 1), p(48, 0.3, -1), p(96, 0.3)];
    for (let tick = 0; tick <= 96; tick += 3) expect(valueAt(PAN, points, tick)).toBe(0.3);
  });

  it('refuses an empty lane', () => {
    expect(() => valueAt(PAN, [], 0)).toThrow();
  });
});

describe('bendCurve', () => {
  it('is u itself at bend 0 or with no rise', () => {
    expect(bendCurve(0.37, 0, 1)).toBe(0.37);
    expect(bendCurve(0.37, 1, 0)).toBe(0.37);
  });
});

describe('rampsBetween', () => {
  it('gives only the end points of a straight segment', () => {
    const points = [p(0, -1), p(96, 1)];
    expect(rampsBetween(PAN, points, { fromTick: 0, toTick: 200 })).toEqual([
      { tick: 0, value: -1 },
      { tick: 96, value: 1 },
    ]);
  });

  it('cuts a bent segment every grain', () => {
    const points = [p(0, -1, 0.5), p(12, 1)];
    const ramps = rampsBetween(PAN, points, { fromTick: 0, toTick: 100, grainTicks: 3 });
    expect(ramps.map((r) => r.tick)).toEqual([0, 3, 6, 9, 12]);
    for (const r of ramps) expect(r.value).toBe(valueAt(PAN, points, r.tick));
    const fine = rampsBetween(PAN, points, { fromTick: 0, toTick: 100 });
    expect(fine).toHaveLength(13);
  });

  it('cuts a straight segment on a dB row, which is a curve in gain', () => {
    const points = [p(0, 0.01), p(4, 1)];
    const ramps = rampsBetween(LEVEL, points, { fromTick: 0, toTick: 10 });
    expect(ramps.map((r) => r.tick)).toEqual([0, 1, 2, 3, 4]);
    for (const r of ramps) expect(r.value).toBe(valueAt(LEVEL, points, r.tick));
  });

  it('gives both points of a step, at one tick', () => {
    const points = [p(0, 0), p(24, 0), p(24, 1), p(48, 1)];
    const ramps = rampsBetween(PAN, points, { fromTick: 12, toTick: 36 });
    expect(ramps).toEqual([
      { tick: 24, value: 0 },
      { tick: 24, value: 1 },
    ]);
  });

  it('gives nothing outside the window', () => {
    const points = [p(0, -1, 1), p(48, 1), p(96, -1), p(144, 0.5, -1), p(192, 0)];
    const ramps = rampsBetween(PAN, points, { fromTick: 40, toTick: 150 });
    expect(ramps.length).toBeGreaterThan(0);
    for (const r of ramps) {
      expect(r.tick).toBeGreaterThanOrEqual(40);
      expect(r.tick).toBeLessThan(150);
      expect(r.value).toBe(valueAt(PAN, points, r.tick));
    }
    expect(ramps.map((r) => r.tick).slice(0, 10)).toEqual([40, 41, 42, 43, 44, 45, 46, 47, 48, 96]);
    expect(rampsBetween(PAN, points, { fromTick: 200, toTick: 300 })).toEqual([]);
    expect(rampsBetween(PAN, points, { fromTick: -50, toTick: 0 })).toEqual([]);
  });

  it('gives each breakpoint to one window of a run, plus the cut where a line spans an edge', () => {
    const points = [p(0, -1, 0.7), p(30, 1), p(30, -1), p(60, 0)];
    const whole = rampsBetween(PAN, points, { fromTick: 0, toTick: 100 });
    const split = [0, 13, 30, 47].flatMap((from, i, starts) =>
      rampsBetween(PAN, points, { fromTick: from, toTick: starts[i + 1] ?? 100 }),
    );
    const cut = { tick: 46, value: valueAt(PAN, points, 46) };
    expect(split).toEqual([...whole.slice(0, -1), cut, whole.at(-1)]);
  });

  it('refuses a grain that is not positive', () => {
    expect(() => rampsBetween(PAN, [p(0, 0)], { fromTick: 0, toTick: 1, grainTicks: 0 })).toThrow();
  });
});

/** The ramps of `rampsBetween` over the consecutive windows `[edges[i], edges[i + 1])`. */
function walk(
  row: AutomationTargetRow,
  points: readonly AutomationPoint[],
  edges: readonly number[],
): { tick: number; value: number; window: number }[] {
  return edges.slice(0, -1).flatMap((fromTick, window) =>
    rampsBetween(row, points, { fromTick, toTick: edges[window + 1]! }).map((r) => ({
      ...r,
      window,
    })),
  );
}

/** Window edges every `step` ticks from `from` up to `to`. */
const edges = (from: number, to: number, step: number): number[] =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

/**
 * The walk's contract: every breakpoint is on the curve, no tick comes twice
 * but a step's pair, and no ramp starts before the previous window, unless
 * the lane is flat across it (so nothing is held while the far end waits).
 */
function expectTraces(
  row: AutomationTargetRow,
  points: readonly AutomationPoint[],
  windowEdges: readonly number[],
): ReturnType<typeof walk> {
  const ramps = walk(row, points, windowEdges);
  ramps.forEach((r, n) => {
    const onStep = points.some((pt) => pt.tick === r.tick && pt.value === r.value);
    if (!onStep) expect(r.value).toBe(valueAt(row, points, r.tick));
    if (n === 0) return;
    const q = ramps[n - 1]!;
    expect(r.tick).toBeGreaterThanOrEqual(q.tick);
    if (r.tick === q.tick) expect(points.filter((pt) => pt.tick === r.tick).length).toBe(2);
    if (r.window > 0 && q.tick < windowEdges[r.window - 1]!) expect(r.value).toBe(q.value);
  });
  return ramps;
}

describe('rampsBetween walked window by window', () => {
  it('traces a long linear ramp in small windows with no hold', () => {
    const points = [p(0, -1), p(480, 1)];
    const ramps = expectTraces(PAN, points, edges(0, 500, 10));
    expect(ramps.map((r) => r.tick).slice(0, 4)).toEqual([0, 9, 19, 29]);
    expect(ramps.at(-1)).toEqual({ tick: 480, value: 1, window: 48 });
    // Ramping straight between the breakpoints is the line at every tick.
    for (let n = 1; n < ramps.length; n++) {
      const [q, r] = [ramps[n - 1]!, ramps[n]!];
      for (let tick = q.tick; tick <= r.tick; tick++) {
        const ramped = q.value + ((r.value - q.value) * (tick - q.tick)) / (r.tick - q.tick);
        expect(ramped).toBeCloseTo(valueAt(PAN, points, tick), 12);
      }
    }
  });

  it('traces a bent segment and a dB row in small windows', () => {
    const bent = [p(0, -1, 0.6), p(200, 1, -0.4), p(400, -0.5)];
    expect(expectTraces(PAN, bent, edges(0, 420, 7)).length).toBe(401);
    const level = [p(0, 0.01), p(300, 2)];
    expect(expectTraces(LEVEL, level, edges(0, 320, 9)).length).toBe(301);
  });

  it('gives a step on a window edge whole to the later window', () => {
    const points = [p(0, -1), p(40, 0), p(40, 1), p(120, 0)];
    const ramps = expectTraces(PAN, points, edges(0, 160, 20));
    expect(ramps.filter((r) => r.tick === 40)).toEqual([
      { tick: 40, value: 0, window: 2 },
      { tick: 40, value: 1, window: 2 },
    ]);
    expect(ramps.find((r) => r.tick === 39)).toMatchObject({ window: 1 });
    expect(ramps.find((r) => r.tick === 39)!.value).toBeCloseTo(-1 / 40, 12);
  });

  it('starts before the first point and ends after the last', () => {
    const points = [p(30, 0.5), p(250, -0.5), p(250, 1), p(300, 1)];
    const ramps = expectTraces(PAN, points, edges(-40, 360, 16));
    expect(ramps[0]).toMatchObject({ tick: 30, value: 0.5 });
    expect(ramps.at(-1)).toMatchObject({ tick: 300, value: 1 });
  });
});

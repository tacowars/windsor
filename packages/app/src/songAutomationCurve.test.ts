/**
 * A lane's curve as SVG geometry (windsor#348 decision 6): flat, stepped and
 * bent lanes in display space, on the engine's own evaluator, at any zoom.
 */
import { describe, expect, it } from 'vitest';
import {
  TICKS_PER_BAR,
  catalogRow,
  toDisplay,
  valueAt,
  type AutomationPoint,
  type AutomationTargetRow,
} from '@windsor/engine';
import { curveShape, type CurveFrame } from './songAutomationCurve';
import { AUTOMATION_DRAWING } from './songAutomationTables';

const BAR = TICKS_PER_BAR;
const H = 56;
const PAD = AUTOMATION_DRAWING.padPx;
const frame = (pxPerBar: number, bars = 4): CurveFrame => ({
  widthPx: bars * pxPerBar,
  heightPx: H,
  pxPerBar,
});
const yOf = (row: AutomationTargetRow, value: number): number =>
  PAD + (1 - toDisplay(row, value)) * (H - 2 * PAD);

/** The path's coordinates, in order. */
const coords = (d: string): [number, number][] =>
  [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

const pan = catalogRow('strip.pan')!;
const cutoff = catalogRow('voice.filter.cutoff')!;
const level = catalogRow('strip.level')!;

describe('curveShape', () => {
  it('draws a flat lane edge to edge, holding before the first point and after the last', () => {
    const points: AutomationPoint[] = [
      { tick: BAR, value: 0.5, bend: 0 },
      { tick: 3 * BAR, value: 0.5, bend: 0 },
    ];
    const shape = curveShape(pan, points, frame(96));
    const y = Number(yOf(pan, 0.5).toFixed(1));
    expect(coords(shape.line)).toEqual([
      [0, y],
      [96, y],
      [288, y],
      [384, y],
    ]);
    expect(shape.area.endsWith('L384.0 56.0 L0 56.0 Z')).toBe(true);
    expect(shape.dots).toHaveLength(2);
  });

  it('draws a step as a vertical line on its tick', () => {
    const points: AutomationPoint[] = [
      { tick: 0, value: -1, bend: 0 },
      { tick: 2 * BAR, value: -1, bend: 0 },
      { tick: 2 * BAR, value: 1, bend: 0 },
    ];
    const xy = coords(curveShape(pan, points, frame(96)).line);
    expect(xy[2]).toEqual([192, PAD + (H - 2 * PAD)]);
    expect(xy[3]).toEqual([192, PAD]);
  });

  it('samples a bent segment every few px on the evaluator', () => {
    const points: AutomationPoint[] = [
      { tick: 0, value: 200, bend: 0.6 },
      { tick: 2 * BAR, value: 8000, bend: 0 },
    ];
    const xy = coords(curveShape(cutoff, points, frame(96)).line);
    const samples = xy.slice(2, -1);
    expect(samples).toHaveLength(Math.ceil(192 / AUTOMATION_DRAWING.sampleEveryPx));
    for (const [x, y] of samples) {
      const tick = (x / 96) * BAR;
      expect(y).toBeCloseTo(yOf(cutoff, valueAt(cutoff, points, tick)), 0);
    }
  });

  it("draws in the knob's scale: the level lane in dB", () => {
    const points: AutomationPoint[] = [{ tick: 0, value: 1, bend: 0 }];
    const [first] = coords(curveShape(level, points, frame(96)).line);
    expect(first![1]).toBeCloseTo(yOf(level, 1), 1);
    expect(toDisplay(level, 1)).toBeGreaterThan(0.9);
  });

  it('scales with the zoom', () => {
    const points: AutomationPoint[] = [
      { tick: 0, value: 0, bend: 0 },
      { tick: BAR, value: 1, bend: 0 },
    ];
    const near = coords(curveShape(pan, points, frame(96)).line);
    const far = coords(curveShape(pan, points, frame(192)).line);
    expect(far.map(([x]) => x)).toEqual(near.map(([x]) => 2 * x));
  });

  it('draws no interior dots when the points outnumber the px', () => {
    const points: AutomationPoint[] = Array.from({ length: 50 }, (_, i) => ({
      tick: (i * BAR) / 50,
      value: i % 2 ? 1 : -1,
      bend: 0,
    }));
    expect(curveShape(pan, points, frame(96)).dots).toHaveLength(50);
    expect(curveShape(pan, points, frame(8, 4)).dots).toHaveLength(2);
  });
});

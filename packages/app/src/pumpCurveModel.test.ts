import { describe, expect, it } from 'vitest';
import { DEFAULT_PUMP, PUMP_MAX_POINTS } from '@windsor/engine';
import type { PumpPoint } from '@windsor/engine';
import {
  addPoint,
  bendPoint,
  handleOf,
  hitPump,
  movePoint,
  removePoint,
  straighten,
  xOf,
  yOf,
} from './pumpCurveModel';
import { PUMP_PLOT } from './pumpTables';

const plot = PUMP_PLOT;
const SHAPE: PumpPoint[] = [
  { at: 0, level: 0, bend: 0 },
  { at: 0.5, level: 0.5, bend: 0 },
  { at: 1, level: 1, bend: 0 },
];
const at = (a: number, level: number) => ({ x: xOf(plot, a), y: yOf(plot, level) });

describe('the Pump editor model', () => {
  it('hits a point first, then a bend handle, then nothing', () => {
    expect(hitPump(SHAPE, at(0.5, 0.5), plot)).toEqual({ kind: 'point', index: 1 });
    expect(hitPump(SHAPE, handleOf(SHAPE, 0, plot), plot)).toEqual({ kind: 'bend', index: 0 });
    expect(hitPump(SHAPE, at(0.25, 0.9), plot)).toEqual({ kind: 'none' });
  });

  it('adds a point snapped to the grid in its span, or freely with Alt, and refuses a full shape', () => {
    const added = addPoint(SHAPE, at(0.27, 0.8), plot, false)!;
    expect(added.index).toBe(1);
    expect(added.points[1]!.at).toBe(0.25);
    expect(added.points[1]!.level).toBeCloseTo(0.8, 9);
    expect(addPoint(SHAPE, at(0.27, 0.8), plot, true)!.points[1]!.at).toBeCloseTo(0.27, 9);
    const full = Array.from({ length: PUMP_MAX_POINTS }, (_, i) => ({
      at: i / (PUMP_MAX_POINTS - 1),
      level: 1,
      bend: 0,
    }));
    expect(addPoint(full, at(0.5, 0.5), plot, false)).toBeNull();
  });

  it('keeps the ends in place in time and an inner point between its neighbours', () => {
    expect(movePoint(SHAPE, 0, at(0.3, 0.7), plot, false)[0]).toEqual({
      at: 0,
      level: 0.7,
      bend: 0,
    });
    const moved = movePoint(SHAPE, 1, at(1, 0.2), plot, false)[1]!;
    expect(moved.at).toBe(1);
    expect(moved.level).toBeCloseTo(0.2, 9);
  });

  it('removes inner points only', () => {
    expect(removePoint(SHAPE, 1)).toEqual([SHAPE[0], SHAPE[2]]);
    expect(removePoint(SHAPE, 0)).toEqual(SHAPE);
    expect(removePoint(DEFAULT_PUMP.points, DEFAULT_PUMP.points.length - 1)).toHaveLength(
      DEFAULT_PUMP.points.length,
    );
  });

  it('bends a rising segment early and a falling one late as its handle is pulled up', () => {
    expect(bendPoint(SHAPE, 0, 0, 30)[0]!.bend).toBeGreaterThan(0);
    const falling: PumpPoint[] = [
      { at: 0, level: 1, bend: 0 },
      { at: 1, level: 0, bend: 0 },
    ];
    expect(bendPoint(falling, 0, 0, 30)[0]!.bend).toBeLessThan(0);
    expect(bendPoint(SHAPE, 0, 0, 10_000)[0]!.bend).toBe(0.95);
    expect(straighten(bendPoint(SHAPE, 0, 0, 30), 0)).toEqual(SHAPE);
  });
});

import { describe, expect, it } from 'vitest';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { DISPLAY_ROW, toDisplay } from './automationDisplay';
import { valueAt } from './automationEvaluate';
import type { AutomationPoint } from './automationLane';
import { AUTOMATION_SHAPE_KINDS, type AutomationShapeKind } from './automationShapeTables';
import { replaceRange, stampShape, type AutomationShapeSpec } from './automationShapes';
import { STRIP_AUTOMATION_ROWS } from './automationTargetTables';

const SIXTEENTH = TICKS_PER_BAR / 16;
const spec = (
  kind: AutomationShapeKind,
  over: Partial<AutomationShapeSpec> = {},
): AutomationShapeSpec => ({
  kind,
  rateTicks: 24,
  top: 1,
  bottom: 0,
  phase: 0,
  duty: 0.5,
  ...over,
});

const at = (points: readonly AutomationPoint[], tick: number): number =>
  valueAt(DISPLAY_ROW, points, tick);
const count = (points: readonly AutomationPoint[], value: number): number =>
  points.filter((q) => q.value === value).length;

describe('stampShape', () => {
  it('puts its edges exactly on the range, in order, for every kind', () => {
    for (const kind of AUTOMATION_SHAPE_KINDS) {
      for (const phase of [0, 0.3]) {
        const points = stampShape(spec(kind, { top: 0.9, bottom: 0.2, phase }), 10, 106);
        expect(points[0]!.tick, kind).toBe(10);
        expect(points.at(-1)!.tick, kind).toBe(106);
        for (let i = 1; i < points.length; i++) {
          expect(points[i]!.tick).toBeGreaterThanOrEqual(points[i - 1]!.tick);
        }
        for (const q of points) {
          expect(q.value).toBeGreaterThanOrEqual(0.2 - 1e-12);
          expect(q.value).toBeLessThanOrEqual(0.9 + 1e-12);
        }
      }
    }
  });

  it('draws the right number of cycles', () => {
    const cycles = 4;
    const end = 24 * cycles;
    expect(count(stampShape(spec('triangle'), 0, end), 1)).toBe(cycles);
    expect(count(stampShape(spec('sine'), 0, end), 1)).toBe(cycles);
    expect(count(stampShape(spec('sine'), 0, end), 0)).toBe(cycles);
    expect(count(stampShape(spec('sawUp'), 0, end), 1)).toBe(cycles);
    expect(count(stampShape(spec('sawDown'), 0, end), 0)).toBe(cycles);
    expect(count(stampShape(spec('square'), 0, end), 1)).toBe(2 * cycles);
  });

  it('gives the square and the saws a step at each cycle boundary', () => {
    const square = stampShape(spec('square'), 0, 48);
    expect(square.filter((q) => q.tick === 24).map((q) => q.value)).toEqual([0, 1]);
    expect(at(square, 24)).toBe(1);
    const saw = stampShape(spec('sawUp'), 0, 48);
    expect(saw.filter((q) => q.tick === 24).map((q) => q.value)).toEqual([1, 0]);
  });

  it('carries the value leaving the start and the value arriving at the end', () => {
    const square = stampShape(spec('square'), 0, 48);
    expect(square[0]!.value).toBe(1);
    expect(square.at(-1)!.value).toBe(0);
    const saw = stampShape(spec('sawUp'), 0, 36);
    expect(saw.at(-1)!.value).toBeCloseTo(0.5, 12);
  });

  it('shifts with the phase', () => {
    expect(stampShape(spec('triangle', { phase: 0.5 }), 0, 48)[0]!.value).toBe(1);
    const shifted = stampShape(spec('square', { phase: 0.25 }), 0, 48);
    expect(shifted.find((q) => q.value === 0)!.tick).toBe(6);
  });

  it("moves the square's fall with the duty, inside 0.1..0.9", () => {
    const fall = (duty: number): number =>
      stampShape(spec('square', { duty }), 0, 24).find((q) => q.value === 0)!.tick;
    expect(fall(0.25)).toBe(6);
    expect(fall(0.75)).toBe(18);
    expect(fall(0)).toBeCloseTo(2.4, 12);
    expect(fall(1)).toBeCloseTo(21.6, 12);
  });

  it('runs ramp and S-curve once from bottom to top, whatever the rate and phase', () => {
    for (const kind of ['ramp', 'sCurve'] as const) {
      const plain = stampShape(spec(kind), 0, 96);
      const moved = stampShape(spec(kind, { rateTicks: 5, phase: 0.6 }), 0, 96);
      expect(moved).toEqual(plain);
      expect(plain[0]!.value).toBe(0);
      expect(plain.at(-1)!.value).toBe(1);
    }
    const s = stampShape(spec('sCurve'), 0, 96);
    expect(s.map((q) => q.bend)).toEqual([-0.6, 0.6, 0]);
    expect(at(s, 24)).toBeLessThan(0.3);
    expect(at(s, 72)).toBeGreaterThan(0.7);
  });

  it('keeps an S-curve an S upside down', () => {
    const s = stampShape(spec('sCurve', { top: 0, bottom: 1 }), 0, 96);
    expect(at(s, 24)).toBeGreaterThan(0.7);
    expect(at(s, 72)).toBeLessThan(0.3);
  });

  it("gives points in the row's units when given a row", () => {
    const level = STRIP_AUTOMATION_ROWS[0]!;
    const display = stampShape(spec('triangle', { top: 0.8, bottom: 0.3 }), 0, 96);
    const units = stampShape(spec('triangle', { top: 0.8, bottom: 0.3 }), 0, 96, level);
    expect(units.map((q) => q.tick)).toEqual(display.map((q) => q.tick));
    units.forEach((q, i) => expect(toDisplay(level, q.value)).toBeCloseTo(display[i]!.value, 12));
  });

  it('keeps a 1/16 square over 32 bars under 2,100 points', () => {
    const points = stampShape(spec('square', { rateTicks: SIXTEENTH }), 0, 32 * TICKS_PER_BAR);
    expect(points.length).toBeLessThan(2100);
  });

  it('refuses an empty range or a rate of 0', () => {
    expect(() => stampShape(spec('ramp'), 10, 10)).toThrow(RangeError);
    expect(() => stampShape(spec('triangle', { rateTicks: 0 }), 0, 10)).toThrow(RangeError);
  });
});

describe('replaceRange', () => {
  it('keeps the points outside the range and replaces those inside it', () => {
    const p = (tick: number, value: number): AutomationPoint => ({ tick, value, bend: 0 });
    const lane = [p(0, 0), p(10, 0.2), p(20, 0.4), p(30, 0.6), p(40, 0.8)];
    const stamped = stampShape(spec('ramp'), 10, 30);
    expect(replaceRange(lane, 10, 30, stamped)).toEqual([p(0, 0), ...stamped, p(40, 0.8)]);
    expect(replaceRange(lane, 12, 18, [])).toEqual(lane);
  });
});

import { describe, expect, it } from 'vitest';
import { FieldNormaliser } from '../song/arrangementFields';
import { PUMP_MAX_POINTS } from './pumpConstants';
import { bendShape, pumpLengthMs, pumpLevelAt } from './pumpCurves';
import { DEFAULT_PUMP, normalisePump } from './pumpSpec';

const normalise = (raw: Record<string, unknown>) => {
  const n = new FieldNormaliser();
  return { spec: normalisePump({ kind: 'pump', ...raw }, 'p', n), n };
};

describe('normalisePump', () => {
  it('reads the defaults back unchanged, silently', () => {
    const { spec, n } = normalise({ ...DEFAULT_PUMP });
    expect(spec).toEqual(DEFAULT_PUMP);
    expect(n.corrections).toEqual([]);
  });

  it('sorts the points, pins the ends to 0 and 1 and clamps each value', () => {
    const { spec, n } = normalise({
      points: [
        { at: 0.8, level: 2, bend: 0 },
        { at: 0.1, level: 0.5, bend: -3 },
        { at: 0.4, level: 0, bend: 0.2 },
      ],
    });
    expect(spec.points).toEqual([
      { at: 0, level: 0.5, bend: -0.95 },
      { at: 0.4, level: 0, bend: 0.2 },
      { at: 1, level: 1, bend: 0 },
    ]);
    expect(n.corrections).toHaveLength(5);
  });

  it('falls back to the default shape for junk or too few points, and keeps at most the maximum', () => {
    expect(normalise({ points: 'x' }).spec.points).toBe(DEFAULT_PUMP.points);
    expect(normalise({ points: [{ at: 0, level: 1, bend: 0 }, 7] }).spec.points).toBe(
      DEFAULT_PUMP.points,
    );
    const many = Array.from({ length: PUMP_MAX_POINTS + 4 }, (_, i) => ({
      at: i / (PUMP_MAX_POINTS + 3),
      level: 0.5,
      bend: 0,
    }));
    expect(normalise({ points: many }).spec.points).toHaveLength(PUMP_MAX_POINTS);
  });

  it('picks a known division and clamps the knobs', () => {
    const { spec } = normalise({ division: '1/5', depth: 3, holdMs: 1, sidechain: { track: 2 } });
    expect(spec.division).toBe('1/4');
    expect(spec.depth).toBe(1);
    expect(spec.holdMs).toBe(10);
    expect(spec.sidechain).toEqual({ track: 2 });
  });
});

describe('the Pump curves', () => {
  it('bends straight at 0, early above it and late below it, through both ends', () => {
    expect(bendShape(0.25, 0)).toBeCloseTo(0.25, 12);
    expect(bendShape(0.25, 0.6)).toBeGreaterThan(0.25);
    expect(bendShape(0.25, -0.6)).toBeLessThan(0.25);
    for (const bend of [-0.95, 0, 0.95]) {
      expect(bendShape(0, bend)).toBe(0);
      expect(bendShape(1, bend)).toBe(1);
    }
    // Mirrored by the bend's sign.
    expect(bendShape(0.3, 0.5)).toBeCloseTo(1 - bendShape(0.7, -0.5), 12);
  });

  it('takes the upper point at a vertical step and the last level past the end', () => {
    const points = [
      { at: 0, level: 0, bend: 0 },
      { at: 0.5, level: 0.2, bend: 0 },
      { at: 0.5, level: 0.8, bend: 0 },
      { at: 1, level: 1, bend: 0 },
    ];
    expect(pumpLevelAt(points, 0.25)).toBeCloseTo(0.1, 12);
    expect(pumpLevelAt(points, 0.5)).toBeCloseTo(0.8, 12);
    expect(pumpLevelAt(points, 1.5)).toBe(1);
  });

  it('times a synced cycle by the tempo and an unsynced one by its ms', () => {
    expect(pumpLengthMs({ sync: true, division: '1/8T', lengthMs: 99 }, 120)).toBeCloseTo(
      500 / 3,
      9,
    );
    expect(pumpLengthMs({ sync: false, division: '1/8T', lengthMs: 99 }, 120)).toBe(99);
  });
});

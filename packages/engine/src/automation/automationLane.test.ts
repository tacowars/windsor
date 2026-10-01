import { describe, expect, it } from 'vitest';
import { pointsInOrder } from './automationLane';

const p = (tick: number, value = 0, bend = 0) => ({ tick, value, bend });

describe('pointsInOrder', () => {
  it('accepts no points, one point, rising ticks and a step', () => {
    expect(pointsInOrder([])).toBe(true);
    expect(pointsInOrder([p(4)])).toBe(true);
    expect(pointsInOrder([p(0), p(1.5), p(6)])).toBe(true);
    expect(pointsInOrder([p(0), p(6, 1), p(6, 0), p(12)])).toBe(true);
  });

  it('refuses a point before the one ahead of it', () => {
    expect(pointsInOrder([p(0), p(6), p(5)])).toBe(false);
  });
});

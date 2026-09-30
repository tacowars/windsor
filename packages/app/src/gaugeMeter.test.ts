import { describe, expect, it } from 'vitest';
import { regauge, restingGauge, stepGauge } from './gaugeMeter';
import { reductionReadout } from './meterModel';
import { REDUCTION_BALLISTICS } from './meterTables';
import { gaugeFor } from './outputStageModel';

/** 12 dB of limiting, held. */
const limited = () => stepGauge(restingGauge(gaugeFor('limiter')), 12, 0);

describe('the GR or Over gauge', () => {
  it('holds a reading while the gauge stays', () => {
    const held = stepGauge(regauge(limited(), gaugeFor('limiter')), 1, 100);
    expect(held.meter.heldDb).toBe(12);
    expect(regauge(held, 'reduction')).toBe(held);
  });

  it('carries no hold from Limiter to Soft clip', () => {
    const soft = regauge(limited(), gaugeFor('soft'));
    expect(soft).toEqual(restingGauge('over'));
    const next = stepGauge(soft, 0.1, 100);
    expect(next.meter.heldDb).toBe(0.1);
    expect(reductionReadout(next.meter.heldDb, false)).not.toContain('12');
  });

  it('carries no hold through Off back to Limiter', () => {
    const off = regauge(limited(), gaugeFor('off'));
    expect(off.meter.heldDb).toBe(-Infinity);
    const back = regauge(stepGauge(off, 0, 50), gaugeFor('limiter'));
    expect(back).toEqual(restingGauge('reduction'));
    expect(stepGauge(back, 0.5, 100).meter.heldDb).toBe(0.5);
  });

  it('starts a regauged meter with a fresh clock', () => {
    const soft = regauge(limited(), 'over');
    expect(soft.lastMs).toBeNull();
    expect(soft.meter.heldSeconds).toBe(0);
    expect(REDUCTION_BALLISTICS.holdSeconds).toBeGreaterThan(0);
  });
});

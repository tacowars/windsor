/**
 * The main-thread scheduling cost meter (#275 decision 7).
 *
 * Two things are pinned here beyond the arithmetic: that the window really
 * rolls (a cost from two seconds ago must not still be in the p95 a listening
 * session reads), and that the percentile method is the bench's, so the
 * overlay's p95 and a bench line's p95 cannot mean two different things.
 */
import { describe, expect, it } from 'vitest';
import { QUANTILES } from '../bench/benchConstants.js';
import { percentile } from '../bench/summary.js';
import { AUDIO_SCHED_QUANTILE } from './audioConstants';
import { SchedCostMeter, ZERO_SCHED_COST } from './schedCost';

/** A meter on a clock the test drives. */
const meterAt = (
  clock: { t: number },
  over: { windowSeconds?: number; maxSamples?: number } = {},
) => new SchedCostMeter({ now: () => clock.t, ...over });

describe('SchedCostMeter', () => {
  it('reports zeros before anything is timed — nothing measured is not 0 ms measured', () => {
    expect(new SchedCostMeter().readout()).toEqual(ZERO_SCHED_COST);
  });

  it('reports the last frame, the mean and the p95 over the window', () => {
    const clock = { t: 1000 };
    const meter = meterAt(clock);
    for (const ms of [0.1, 0.2, 0.3, 0.4]) {
      meter.sample(ms);
      clock.t += 16;
    }
    const r = meter.readout();
    expect(r.frames).toBe(4);
    expect(r.lastMs).toBe(0.4);
    expect(r.meanMs).toBeCloseTo(0.25, 12);
    expect(r.p95Ms).toBe(0.4);
  });

  it('rolls: a sample older than the window drops out', () => {
    const clock = { t: 0 };
    const meter = meterAt(clock, { windowSeconds: 1 });
    meter.sample(9); // a one-off stall
    clock.t = 1001;
    meter.sample(0.2);
    const r = meter.readout();
    expect(r.frames).toBe(1);
    expect(r.p95Ms).toBe(0.2);
  });

  it('keeps a sample that is exactly at the window edge', () => {
    const clock = { t: 0 };
    const meter = meterAt(clock, { windowSeconds: 1 });
    meter.sample(9);
    clock.t = 1000;
    meter.sample(0.2);
    expect(meter.readout().frames).toBe(2);
  });

  it('caps the buffer, so a clock that stops advancing cannot grow it without bound', () => {
    const clock = { t: 0 };
    const meter = meterAt(clock, { windowSeconds: 1, maxSamples: 4 });
    for (let i = 0; i < 100; i++) meter.sample(i);
    const r = meter.readout();
    expect(r.frames).toBe(4);
    expect(r.lastMs).toBe(99);
  });

  it('forgets everything on reset — a disposed system reports nothing, not stale numbers', () => {
    const meter = new SchedCostMeter();
    meter.sample(0.5);
    meter.reset();
    expect(meter.readout()).toEqual(ZERO_SCHED_COST);
  });
});

describe('the percentile is the bench’s (one definition, #147 item 7)', () => {
  it('reports the quantile the bench reports', () => {
    expect(AUDIO_SCHED_QUANTILE).toBe(QUANTILES.p95);
  });

  it('agrees with bench/summary.ts percentile on the same samples', () => {
    // Nearest-rank, both sides. A run of 20 costs makes the rank land off a
    // round boundary, which is where two methods would disagree.
    const costs = [0.9, 0.1, 0.4, 0.2, 0.8, 0.3, 0.7, 0.5, 0.6, 1.0, 0.15, 0.25, 0.35, 0.45, 0.55];
    const clock = { t: 0 };
    const meter = meterAt(clock);
    for (const ms of costs) meter.sample(ms);
    const sorted = [...costs].sort((a, b) => a - b);
    expect(meter.readout().p95Ms).toBe(percentile(sorted, QUANTILES.p95));
  });
});

/**
 * The meter in the one clock (windsor#428): an option and a setter, 4/4 until
 * set, read by `TickEvent.bar` and the swing warp, through the song wrap and
 * a loop's jump.
 */
import { describe, expect, it } from 'vitest';

import { songTicks, ticksPerBar } from './meter';
import { METERS, type Meter } from './meterTables';
import { Scheduler, TickTransport, type TickEvent } from './scheduler';
import type { Swing } from './swingTables';

describe('the scheduler meter (windsor#428)', () => {
  it('defaults to 4/4 and takes the meter as an option and live', () => {
    const scheduler = new Scheduler({ currentTime: 0 });
    expect(scheduler.meter).toBe('4/4');
    const sevenEight = new Scheduler({ currentTime: 0 }, { meter: '7/8' });
    expect(sevenEight.meter).toBe('7/8');
    expect(sevenEight.transport.meter).toBe('7/8');
    scheduler.meter = '6/8';
    expect(scheduler.transport.meter).toBe('6/8');
    scheduler.meter = '9/8' as Meter;
    expect(scheduler.meter).toBe('4/4');
  });

  it("counts TickEvent's bar in the meter's bars", () => {
    for (const meter of METERS) {
      const transport = new TickTransport();
      transport.meter = meter;
      const events: TickEvent[] = [];
      transport.subscribe(1, (e) => events.push(e));
      for (let t = 0; t < 3 * ticksPerBar(meter); t++) transport.advance(0);
      const bar = ticksPerBar(meter);
      expect(events[bar - 1]).toMatchObject({ bar: 0, tickInBar: bar - 1 });
      expect(events[bar]).toMatchObject({ bar: 1, tickInBar: 0 });
      expect(events[2 * bar + 5]).toMatchObject({ bar: 2, tickInBar: 5 });
    }
  });

  it('swings 7/8 per beat in the clock, the remainder straight', () => {
    const transport = new TickTransport(120, { amount: 75, grid: 8 });
    transport.meter = '7/8';
    const seconds: number[] = [];
    transport.subscribe(1, (e) => seconds.push(e.seconds));
    for (let t = 0; t <= 2 * 84; t++) transport.advance(0);
    const spt = transport.secondsPerTick;
    for (const start of [0, 84]) {
      for (const [tick, at] of [
        [0, 0],
        [12, 18],
        [24, 24],
        [36, 42],
        [48, 48],
        [60, 66],
        [72, 72],
        [84, 84],
      ] as const) {
        expect((seconds[start + tick]! - seconds[start]!) / spt).toBeCloseTo(at, 9);
      }
    }
  });

  it('stamps monotonic times and inverts exactly across the song wrap and a loop jump', () => {
    const swings: Swing[] = [
      { amount: 75, grid: 8 },
      { amount: 62.5, grid: 16 },
      { amount: 200 / 3, grid: 8 },
    ];
    for (const meter of METERS) {
      for (const swing of swings) {
        const bars = 3;
        const length = songTicks(bars, meter);
        const transport = new TickTransport(131, swing);
        transport.meter = meter;
        const issued: { tick: number; seconds: number }[] = [];
        transport.subscribe(1, (e) => issued.push({ tick: e.tick, seconds: e.seconds }));
        // Play past the song's end, then loop beat 2 to the end of bar 2.
        for (let t = 0; t < length + ticksPerBar(meter); t++) transport.advance(0);
        transport.loop = { start: 24, end: 2 * ticksPerBar(meter), songTicks: length };
        for (let t = 0; t < 3 * length; t++) transport.advance(0);
        const jumps = issued.filter((e, i) => i > 0 && e.tick < issued[i - 1]!.tick).length;
        expect(jumps).toBeGreaterThan(0);
        for (let i = 1; i < issued.length; i++) {
          expect(issued[i]!.seconds).toBeGreaterThan(issued[i - 1]!.seconds);
        }
        for (const { tick } of issued) {
          expect(transport.unswungTicks(transport.swungTicks(tick))).toBeCloseTo(tick, 9);
        }
      }
    }
  });
});

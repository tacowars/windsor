import { describe, expect, it } from 'vitest';

import {
  DIVISORS,
  PPQ,
  Scheduler,
  TICKS_PER_BAR,
  TickTransport,
  WHOLE_NOTE_TICKS,
  isNoteDivisor,
  type TickEvent,
} from './scheduler';

function run(transport: TickTransport, ticks: number): void {
  for (let i = 0; i < ticks; i++) transport.advance(i * transport.secondsPerTick);
}

describe('the 24 PPQ grid', () => {
  it('puts every step length of the record on an exact integer', () => {
    expect(PPQ).toBe(24);
    expect(TICKS_PER_BAR).toBe(96);
    expect(DIVISORS).toEqual({
      whole: 96,
      half: 48,
      quarter: 24,
      eighth: 12,
      sixteenth: 6,
      thirtySecond: 3,
    });
  });

  it('leaves triplets expressible without touching the transport', () => {
    expect(isNoteDivisor(8)).toBe(true); // 1/8T
    expect(isNoteDivisor(4)).toBe(true); // 1/16T
    expect(isNoteDivisor(5)).toBe(false);
    expect(isNoteDivisor(0)).toBe(false);
    expect(isNoteDivisor(1.5)).toBe(false);
  });

  it('accepts exactly the divisors of the 96-tick whole note (windsor#428)', () => {
    expect(DIVISORS.whole).toBe(WHOLE_NOTE_TICKS);
    for (let d = -4; d <= 200; d++) expect(isNoteDivisor(d)).toBe(d > 0 && 96 % d === 0);
  });
});

describe('TickTransport fan-out', () => {
  it('keeps subscribers at different divisors phase-locked over 64 bars', () => {
    const transport = new TickTransport(96);
    const hat: number[] = [];
    const quarter: number[] = [];
    transport.subscribe(DIVISORS.thirtySecond, (e) => hat.push(e.tick));
    transport.subscribe(DIVISORS.quarter, (e) => quarter.push(e.tick));

    const bars = 64;
    run(transport, bars * TICKS_PER_BAR);

    expect(hat).toHaveLength(32 * bars);
    expect(quarter).toHaveLength(4 * bars);
    // Every quarter lands on a hat tick: one clock, no drift.
    const hatTicks = new Set(hat);
    for (const t of quarter) expect(hatTicks.has(t)).toBe(true);
    // Exactly 32 and 4 per bar, every bar, not just on average.
    for (let bar = 0; bar < bars; bar++) {
      const lo = bar * TICKS_PER_BAR;
      const hi = lo + TICKS_PER_BAR;
      expect(hat.filter((t) => t >= lo && t < hi)).toHaveLength(32);
      expect(quarter.filter((t) => t >= lo && t < hi)).toHaveLength(4);
    }
    expect(hat.at(-1)).toBe(bars * TICKS_PER_BAR - 3);
    expect(quarter.at(-1)).toBe(bars * TICKS_PER_BAR - 24);
  });

  it('stamps each event with step, bar and position in the bar', () => {
    const transport = new TickTransport(120);
    const seen: TickEvent[] = [];
    transport.subscribe(DIVISORS.eighth, (e) => seen.push(e));
    run(transport, 2 * TICKS_PER_BAR + 12);
    expect(seen.map((e) => e.step)).toEqual(Array.from({ length: 17 }, (_, i) => i));
    expect(seen.map((e) => e.tick)).toEqual(seen.map((e) => e.step * 12));
    expect(seen[8]).toMatchObject({ tick: 96, bar: 1, tickInBar: 0 });
    expect(seen[9]).toMatchObject({ tick: 108, bar: 1, tickInBar: 12 });
    expect(seen[16]).toMatchObject({ tick: 192, bar: 2, tickInBar: 0 });
  });

  it('maps ticks to transport seconds at the running tempo', () => {
    const transport = new TickTransport(120);
    expect(transport.secondsPerTick).toBeCloseTo(0.5 / 24, 12);
    const seconds: number[] = [];
    transport.subscribe(DIVISORS.quarter, (e) => seconds.push(e.seconds));
    run(transport, TICKS_PER_BAR);
    expect(seconds.map((s) => Number(s.toFixed(9)))).toEqual([0, 0.5, 1, 1.5]);
    const spt = new Set<number>();
    transport.subscribe(1, (e) => spt.add(e.secondsPerTick));
    run(transport, 3);
    expect([...spt]).toEqual([transport.secondsPerTick]);
  });

  it('honours unsubscribe, including from inside a handler', () => {
    const transport = new TickTransport();
    let a = 0;
    let b = 0;
    const offA = transport.subscribe(1, () => a++);
    const offB = transport.subscribe(1, () => {
      b++;
      offB();
    });
    run(transport, 5);
    offA();
    run(transport, 5);
    expect(a).toBe(5);
    expect(b).toBe(1);
  });

  it('rejects a divisor that is not a positive integer', () => {
    const transport = new TickTransport();
    expect(() => transport.subscribe(0, () => {})).toThrow(RangeError);
    expect(() => transport.subscribe(2.5, () => {})).toThrow(RangeError);
  });

  it('resets to a chosen tick with the matching seconds', () => {
    const transport = new TickTransport(120);
    run(transport, 10);
    transport.reset(96);
    expect(transport.currentTick).toBe(96);
    expect(transport.transportSeconds).toBeCloseTo(2, 12);
  });
});

describe('Scheduler look-ahead against a fake clock', () => {
  it('queues ticks up to the horizon, spaced by secondsPerTick, and no further', () => {
    const clock = { currentTime: 10 };
    const scheduler = new Scheduler(clock, { bpm: 120, lookAhead: 0.25 });
    const times: number[] = [];
    scheduler.subscribe(1, (e) => times.push(e.time));

    scheduler.start();
    scheduler.update();
    const spt = scheduler.transport.secondsPerTick;
    expect(times[0]).toBeCloseTo(10.06, 12);
    expect(times.at(-1)).toBeLessThan(10.25);
    expect(times.at(-1)! + spt).toBeGreaterThanOrEqual(10.25);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeCloseTo(spt, 12);

    const queued = times.length;
    scheduler.update();
    expect(times).toHaveLength(queued);
    clock.currentTime += 0.5;
    scheduler.update();
    expect(times.length).toBeGreaterThan(queued);
  });

  it('does nothing while stopped and restarts from tick 0', () => {
    const clock = { currentTime: 0 };
    const scheduler = new Scheduler(clock, { bpm: 120 });
    const ticks: number[] = [];
    scheduler.subscribe(1, (e) => ticks.push(e.tick));
    scheduler.update();
    expect(ticks).toEqual([]);
    scheduler.start();
    scheduler.update();
    expect(ticks[0]).toBe(0);
    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
    const n = ticks.length;
    clock.currentTime = 5;
    scheduler.update();
    expect(ticks).toHaveLength(n);
    scheduler.start();
    scheduler.update();
    expect(ticks[n]).toBe(0);
  });

  it('reports the audible tick behind the look-ahead queue (#603)', () => {
    const clock = { currentTime: 10 };
    const scheduler = new Scheduler(clock, { bpm: 120, lookAhead: 0.25 });
    const times: number[] = [];
    scheduler.subscribe(1, (e) => times.push(e.time));
    scheduler.start();
    scheduler.update();
    // Nothing sounds before the first stamped tick; the queue itself is well ahead.
    expect(scheduler.audibleTick(10)).toBe(0);
    expect(scheduler.transport.currentTick).toBeGreaterThan(3);
    // Exactly at tick 3's stamp it is audible; a hair before, tick 2 still is.
    expect(scheduler.audibleTick(times[3]!)).toBe(3);
    expect(scheduler.audibleTick(times[3]! - 1e-6)).toBe(2);
    // Past every issued tick with the queue stopped, the last issued one holds.
    scheduler.stop();
    expect(scheduler.audibleTick(times.at(-1)! + 1)).toBe(times.length - 1);
  });

  it('reset() after stop() reads tick 0 and the next start() issues tick 0 first (#708)', () => {
    const clock = { currentTime: 0 };
    const scheduler = new Scheduler(clock, { bpm: 120 });
    const ticks: number[] = [];
    scheduler.subscribe(1, (e) => ticks.push(e.tick));
    scheduler.start();
    clock.currentTime = 1;
    scheduler.update();
    scheduler.stop();
    // stop() alone keeps the tick: the mute path resumes where it halted.
    const halted = scheduler.transport.currentTick;
    expect(halted).toBeGreaterThan(0);
    clock.currentTime = 2;
    expect(scheduler.audibleTick(clock.currentTime)).toBe(halted - 1);
    scheduler.start(scheduler.transport.currentTick);
    scheduler.update();
    expect(ticks[halted]).toBe(halted);
    scheduler.stop();

    scheduler.reset();
    expect(scheduler.isRunning).toBe(false);
    expect(scheduler.audibleTick(clock.currentTime)).toBe(0);
    const n = ticks.length;
    scheduler.start(scheduler.transport.currentTick);
    scheduler.update();
    expect(ticks[n]).toBe(0);
  });

  it('exposes bpm through to the transport', () => {
    const scheduler = new Scheduler({ currentTime: 0 }, { bpm: 96 });
    expect(scheduler.bpm).toBe(96);
    scheduler.bpm = 120;
    expect(scheduler.transport.secondsPerTick).toBeCloseTo(0.5 / 24, 12);
  });
});

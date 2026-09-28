/**
 * Swing in the one clock (windsor#14): straight is the old clock bit for bit,
 * a swung off-beat lands where the amount says, the playhead unwarps, and a
 * tempo change or the song wrap leaves the pairs on the grid.
 */
import { describe, expect, it } from 'vitest';

import { Scheduler, TICKS_PER_BAR, TickTransport } from './scheduler';
import { STRAIGHT_SWING, type Swing } from './swingTables';

const HARD: Swing = { amount: 75, grid: 16 };
const TRIPLET: Swing = { amount: 200 / 3, grid: 16 };

/** Every tick's stamp from one long look-ahead: `times[t]` is tick `t`'s clock time. */
function stamps(
  options: { bpm: number; swing?: Swing },
  ticks: number,
): {
  scheduler: Scheduler;
  times: number[];
} {
  const clock = { currentTime: 0 };
  const scheduler = new Scheduler(clock, { ...options, lookAhead: 0 });
  const times: number[] = [];
  scheduler.subscribe(1, (e) => times.push(e.time));
  scheduler.start();
  while (times.length < ticks) {
    clock.currentTime += 0.01;
    scheduler.update();
  }
  return { scheduler, times };
}

describe('the swung clock (windsor#14)', () => {
  it('is bit-identical to the unswung clock when straight', () => {
    const plain = stamps({ bpm: 123 }, 400).times;
    const straight = stamps({ bpm: 123, swing: STRAIGHT_SWING }, 400).times;
    expect(straight.slice(0, 400)).toEqual(plain.slice(0, 400));
    const a = new TickTransport(123);
    const b = new TickTransport(123, { amount: 50, grid: 8 });
    const secondsA: number[] = [];
    const secondsB: number[] = [];
    a.subscribe(1, (e) => secondsA.push(e.seconds));
    b.subscribe(1, (e) => secondsB.push(e.seconds));
    for (let i = 0; i < 300; i++) {
      a.advance(0);
      b.advance(0);
    }
    expect(secondsB).toEqual(secondsA);
  });

  it('lands the off-beat 16th at 3/4 of the 8th at 75 and 2/3 at 66.7', () => {
    for (const [swing, at] of [
      [HARD, 0.75],
      [TRIPLET, 2 / 3],
    ] as const) {
      const { times } = stamps({ bpm: 120, swing }, 100);
      for (const start of [0, 12, 48, 84]) {
        const eighth = times[start + 12]! - times[start]!;
        expect(eighth).toBeCloseTo((12 * 0.5) / 24, 12);
        expect((times[start + 6]! - times[start]!) / eighth).toBeCloseTo(at, 9);
      }
    }
  });

  it('stamps every tick later than the one before', () => {
    const { times } = stamps({ bpm: 180, swing: { amount: 75, grid: 8 } }, 300);
    for (let t = 1; t < times.length; t++) expect(times[t]!).toBeGreaterThan(times[t - 1]!);
  });

  it('reads the playhead back through the warp: audibleTick(time(t)) is t', () => {
    for (const swing of [STRAIGHT_SWING, HARD, TRIPLET, { amount: 58.5, grid: 8 } as Swing]) {
      const clock = { currentTime: 0 };
      const scheduler = new Scheduler(clock, { bpm: 97, swing, lookAhead: 10 });
      const times: number[] = [];
      scheduler.subscribe(1, (e) => times.push(e.time));
      scheduler.start();
      scheduler.update();
      for (let t = 0; t < times.length - 1; t++) {
        expect(scheduler.audibleTick(times[t]!)).toBe(t);
        // Just before the next tick sounds, this one still holds.
        expect(scheduler.audibleTick((times[t]! + times[t + 1]!) / 2)).toBe(t);
      }
    }
  });

  it('keeps the pairs on the grid through a tempo change mid-pair', () => {
    const transport = new TickTransport(120, HARD);
    const seconds: number[] = [];
    transport.subscribe(1, (e) => seconds.push(e.seconds));
    for (let t = 0; t < 200; t++) {
      if (t === 15) transport.bpm = 90; // inside the pair [12, 24)
      transport.advance(0);
    }
    for (const start of [24, 36, 96, 180]) {
      const pair = seconds[start + 12]! - seconds[start]!;
      expect(pair).toBeCloseTo((12 * 60) / 90 / 24, 12);
      expect((seconds[start + 6]! - seconds[start]!) / pair).toBeCloseTo(0.75, 9);
    }
  });

  it('keeps the swing phase across the song wrap and a restart mid-song', () => {
    const songTicks = 3 * TICKS_PER_BAR;
    const { times } = stamps({ bpm: 120, swing: HARD }, 2 * songTicks + 24);
    const eighth = times[12]! - times[0]!;
    for (const start of [songTicks - 12, songTicks, 2 * songTicks]) {
      expect((times[start + 6]! - times[start]!) / eighth).toBeCloseTo(0.75, 9);
    }
    const resumed = new TickTransport(120, HARD);
    resumed.reset(songTicks + 6);
    expect(resumed.transportSeconds).toBeCloseTo((songTicks + 9) * resumed.secondsPerTick, 12);
  });

  it('takes a live swing edit on the next tick', () => {
    const scheduler = new Scheduler({ currentTime: 0 });
    expect(scheduler.swing).toEqual(STRAIGHT_SWING);
    scheduler.swing = HARD;
    expect(scheduler.transport.swing).toBe(HARD);
    expect(scheduler.transport.intervalSeconds(0)).toBeCloseTo(
      1.5 * scheduler.transport.secondsPerTick,
      12,
    );
  });
});

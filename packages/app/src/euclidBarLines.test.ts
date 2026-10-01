/**
 * The Hz plot's anchor after a live tempo change (windsor#383, decision 3):
 * the seconds the scheduler stamped on the audible bar's line, which the
 * sequencer read for its `k`, not a rewind of the clock at the new tempo.
 */
import { describe, expect, it } from 'vitest';

import type { EuclideanConfig, TickHandler, TickSource } from '@windsor/engine';
import {
  DEFAULT_EUCLIDEAN_CONFIG,
  EuclideanSequencer,
  TICKS_PER_BAR,
  TickTransport,
} from '@windsor/engine';
import { BarLineLog, BarLineWatch, plotSeconds } from './euclidBarLines';
import { barLineSeconds, lfoKs } from './euclidDensityModel';
import { countOnsets } from './euclidModel';

const BAR = TICKS_PER_BAR;
const HZ: EuclideanConfig = {
  ...DEFAULT_EUCLIDEAN_CONFIG,
  pulses: { min: 1, max: 12, start: 4 },
  density: { kind: 'lfoHz', hz: 1, shape: 'saw' },
};
const SPEC = { ...HZ, kind: 'euclidean' as const, note: 50, hold: 0.1, pattern: null };

/** Issue `count` ticks, each stamped one straight tick after the last at the clock's tempo. */
function run(clock: TickTransport, count: number, from: { time: number }): void {
  for (let i = 0; i < count; i++) {
    clock.advance(from.time);
    from.time += clock.secondsPerTick;
  }
}

describe('the Hz plot after a tempo change with ticks queued', () => {
  it("anchors on the audible bar line's stamp, the seconds the sequencer read", () => {
    const clock = new TickTransport(120);
    const sequencer = new EuclideanSequencer(HZ);
    sequencer.attach(clock);
    const watch = new BarLineWatch();
    watch.follow(clock);
    const time = { time: 0 };
    // Bar 0, then bar 1's line and nine more ticks queued ahead of the ear.
    run(clock, BAR + 10, time);
    const lineTime = BAR * (60 / 120 / 24);
    const audible = { tick: BAR + 2, now: lineTime + 2 * clock.secondsPerTick };
    // The tempo halves live: the queued ticks keep the old timing.
    clock.bpm = 60;
    const seconds = plotSeconds(watch.log, clock, audible);
    expect(seconds).toBeCloseTo(2, 9);
    const played = countOnsets(sequencer.currentPattern);
    const plot = { bar: 1, seconds, secondsPerBar: BAR * clock.secondsPerTick };
    expect(lfoKs(SPEC, plot, 1)[0]).toBe(played);
    // The rewind at the new tempo puts bar 1's line too early, and plots another k.
    const rewound = barLineSeconds(clock, audible.tick);
    expect(rewound).toBeLessThan(2);
    expect(lfoKs(SPEC, { ...plot, seconds: rewound }, 1)[0]).not.toBe(played);
  });

  it('falls back to the rewind for a bar line it did not see issued', () => {
    const clock = new TickTransport(120);
    run(clock, BAR + 10, { time: 0 });
    const log = new BarLineLog();
    expect(plotSeconds(log, clock, { tick: BAR + 2, now: 10 })).toBeCloseTo(2, 9);
  });
});

describe('the bar line log', () => {
  it("takes a loop line's latest issue that has sounded, not a queued repeat", () => {
    const log = new BarLineLog();
    log.record({ tick: 0, seconds: 0, time: 0 });
    log.record({ tick: 0, seconds: 2, time: 2 });
    log.record({ tick: 0, seconds: 4, time: 4 });
    expect(log.secondsAt(0, 3.9)).toBe(2);
    expect(log.secondsAt(0, 4)).toBe(4);
    expect(log.secondsAt(BAR, 4)).toBeNull();
  });

  it('keeps only the latest lines', () => {
    const log = new BarLineLog(2);
    for (let bar = 0; bar < 3; bar++) log.record({ tick: bar * BAR, seconds: bar, time: bar });
    expect(log.secondsAt(0, 9)).toBeNull();
    expect(log.secondsAt(2 * BAR, 9)).toBe(2);
  });
});

describe('the bar line watch', () => {
  /** A source counting its live subscriptions. */
  function source(): TickSource & { readonly live: () => number; issue: TickHandler } {
    const handlers = new Set<TickHandler>();
    return {
      live: () => handlers.size,
      issue: (event) => handlers.forEach((h) => h(event)),
      subscribe: (_divisor, handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    };
  }
  const line = { tick: BAR, step: 1, bar: 1, tickInBar: 0, seconds: 2, secondsPerTick: 1, time: 2 };

  it('moves to a rebuilt system with an empty log, and lets go on close', () => {
    const watch = new BarLineWatch();
    const a = source();
    watch.follow(a);
    watch.follow(a);
    expect(a.live()).toBe(1);
    a.issue(line);
    expect(watch.log.secondsAt(BAR, 2)).toBe(2);
    const b = source();
    watch.follow(b);
    expect([a.live(), b.live()]).toEqual([0, 1]);
    expect(watch.log.secondsAt(BAR, 2)).toBeNull();
    watch.follow(null);
    expect(b.live()).toBe(0);
  });
});

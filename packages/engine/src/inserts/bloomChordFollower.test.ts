/**
 * Song chord's follower (windsor#729) against a hand-driven transport: each
 * change one fade before its tick, nothing between chords on one set, the
 * cyclic timeline's leading hold, a hold at every jump (the start, the
 * song's wrap, the loop), a re-plan after a harmony or a length edit that
 * schedules the issued ticks again, the holds while stopped, and a tick that
 * allocates nothing.
 */
import { PerformanceObserver } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import type { Harmony } from '../harmony/harmonyTimeline';
import type { TickEvent, TickHandler } from '../sequencing/scheduler';
import { BloomChordFollower } from './bloomChordFollower';
import { chordPitches } from './bloomPitches';
import { BLOOM_GENERATOR } from './bloomGeneratorConstants';

const FADE = BLOOM_GENERATOR.switchSeconds;
const SONG = 4 * 96;
/** 120 BPM straight, from one second in; the clock runs ten ticks behind the queue. */
const TICK = 1 / 48;
const START = 1;
const LOOK = 10 * TICK;
const at = (tick: number): number => START + tick * TICK;

/** C major: I from tick 24 (V holds before it), I again an octave up, then vi, IV, V. */
const SONG_HARMONY: Harmony = {
  root: 0,
  scale: 'major',
  events: [
    { start: 24, duration: 36, degree: 0, size: 3 },
    { start: 60, duration: 36, degree: 7, size: 3 },
    { start: 96, duration: 96, degree: 5, size: 3 },
    { start: 192, duration: 96, degree: 3, size: 3 },
    { start: 288, duration: 96, degree: 4, size: 3 },
  ],
};
const set = (degree: number): number =>
  chordPitches(SONG_HARMONY, { start: 0, duration: 1, degree, size: 3 });
const [I, VI, IV, V] = [set(0), set(5), set(3), set(4)];

interface Call {
  readonly mask: number;
  readonly time: number;
  readonly hold: boolean;
}

/** A follower on a hand-driven transport; `record` false hands the sets to a sink that keeps nothing. */
function rig(record = true) {
  let handler: TickHandler | null = null;
  const clock = { now: 0 };
  const calls: Call[] = [];
  let handed = 0;
  const follower = new BloomChordFollower({
    transport: {
      subscribe: (_divisor, h) => {
        handler = h;
        return () => (handler = null);
      },
    },
    now: () => clock.now,
    sink: record ? (mask, time, hold) => calls.push({ mask, time, hold }) : () => handed++,
    harmony: SONG_HARMONY,
    songTicks: SONG,
    restTick: 0,
  });
  const event: TickEvent = {
    tick: 0,
    step: 0,
    bar: 0,
    tickInBar: 0,
    seconds: 0,
    secondsPerTick: TICK,
    time: 0,
  };
  /** Issue transport ticks `from`..`to` a tick apart from `first`, the clock `LOOK` behind each. */
  const run = (from: number, to: number, first = at(from)): void => {
    for (let tick = from; tick <= to; tick++) {
      event.tick = tick;
      event.time = first + (tick - from) * TICK;
      clock.now = event.time - LOOK;
      handler!(event);
    }
  };
  /** The calls since `mark`. */
  const since = (mark: number): Call[] => calls.slice(mark);
  return {
    follower,
    calls,
    clock,
    run,
    since,
    handed: () => handed,
    unsubscribed: () => handler === null,
  };
}

const hold = (mask: number, time: number): Call => ({ mask, time, hold: true });
const change = (mask: number, tick: number): Call => ({ mask, time: at(tick) - FADE, hold: false });

describe('the follower, tick by tick', () => {
  it('holds the rest, then schedules each change one fade early, through the wrap', () => {
    const { calls, run } = rig();
    // At rest on tick 0, before the first chord: the last one holds (the timeline is cyclic).
    expect(calls).toEqual([hold(V, 0)]);
    run(0, SONG + 30);
    expect(calls.slice(1)).toEqual([
      hold(V, at(0) - FADE),
      change(I, 24),
      // Nothing at 60: an octave higher, the same set.
      change(VI, 96),
      change(IV, 192),
      change(V, 288),
      // The song's wrap is a jump: a hold.
      hold(V, at(SONG) - FADE),
      change(I, SONG + 24),
    ]);
  });

  it('holds the jump target at a loop jump back', () => {
    const { run, since, calls } = rig();
    run(0, 200);
    const mark = calls.length;
    // The loop [96, 201) wraps: tick 96 again, at the next tick's time.
    run(96, 96, at(201));
    expect(since(mark)).toEqual([hold(VI, at(201) - FADE)]);
  });
});

describe('a re-plan', () => {
  it('after a harmony edit holds the playhead and schedules the issued ticks again', () => {
    const { follower, run, since, calls, clock } = rig();
    run(0, 185);
    const mark = calls.length;
    const moved = SONG_HARMONY.events.map((e) => (e.start === 192 ? { ...e, start: 180 } : e));
    follower.setSong({ ...SONG_HARMONY, events: moved }, SONG);
    expect(since(mark)).toEqual([hold(VI, clock.now), change(IV, 180)]);
  });

  it('after a length edit folds the issued ticks by the new length, then plays on', () => {
    const { follower, run, since, calls, clock } = rig();
    run(0, 200);
    const mark = calls.length;
    // Two bars, I then vi: tick 192, issued as IV, is the song's start again.
    const events = [
      { start: 0, duration: 96, degree: 0, size: 3 },
      { start: 96, duration: 96, degree: 5, size: 3 },
    ] as const;
    follower.setSong({ ...SONG_HARMONY, events }, 2 * 96);
    expect(since(mark)).toEqual([hold(VI, clock.now), change(I, 192)]);
    // Tick 201 follows 200 under the new length: no jump, and vi again at 288.
    run(201, 300);
    expect(since(mark).slice(2)).toEqual([change(VI, 288)]);
  });
});

describe('stopped', () => {
  it('holds where the playhead stood, then at each seek and rewind', () => {
    const { follower, run, since, calls, clock } = rig();
    run(0, 120);
    const mark = calls.length;
    // Ten ticks behind the queue: tick 110 is sounding.
    follower.stop();
    follower.seek(300);
    follower.rewound(30);
    expect(since(mark)).toEqual([hold(VI, clock.now), hold(V, clock.now), hold(I, clock.now)]);
    // A re-plan while stopped holds where the playhead rests.
    follower.replan();
    expect(calls.at(-1)).toEqual(hold(I, clock.now));
    // The next start is a jump, held at its tick.
    run(30, 30, at(400));
    expect(calls.at(-1)).toEqual(hold(I, at(400) - FADE));
  });

  it('stops hearing the transport once disposed', () => {
    const { follower, unsubscribed } = rig();
    follower.dispose();
    expect(unsubscribed()).toBe(true);
  });
});

describe('allocation', () => {
  it('runs a million ticks across chord changes and wraps with no garbage collection', async () => {
    const { run, handed } = rig(false);
    // Warm: optimise the path, and let the issued-tick arrays reach their size.
    run(0, 500 * SONG);
    const collections: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) collections.push(entry.startTime);
    });
    observer.observe({ entryTypes: ['gc'] });
    const from = performance.now();
    run(500 * SONG + 1, 500 * SONG + 1_000_000);
    const to = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 50));
    observer.disconnect();
    expect(collections.filter((t) => t >= from && t <= to)).toEqual([]);
    // It did hand sets over: five changes a pass, one a hold at the wrap.
    expect(handed()).toBeGreaterThan(10_000);
  });
});

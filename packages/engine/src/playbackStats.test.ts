/**
 * The `AudioContext.playbackStats` reader (#275).
 *
 * Every case here is driven by a plain object, not a browser: the module is
 * pure over an injected `{ playbackStats? }`-shaped host precisely so the
 * behaviour the target box probed can be pinned without one
 * (`docs/research/2026-09-14-275-playbackstats-probe/`).
 *
 * The boundary fixtures the ticket names are the last four `describe` blocks:
 * a live object that mutates under a held reference, a `minimumLatency` that
 * is a real `0` rather than an absence, the units of a single event, and a
 * context suspended mid-window.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_STATS_SETTLE_MS } from './audioConstants';
import {
  PlaybackStatsWindow,
  hasPlaybackStats,
  playbackLatencies,
  playbackWindowDelta,
  snapshotPlaybackStats,
  underrunMsPerEvent,
  type AudioPlaybackStatsApi,
  type PlaybackStatsHost,
} from './playbackStats';

/** What one output-device callback is worth on the target box: 512 frames at 48 kHz. */
const EVENT_SECONDS = 0.0106667;

/**
 * A stand-in for the live object: mutable fields behind one identity, exactly
 * as Chrome hands it back (`sameObject: true` on every probe read).
 */
class FakeStats implements AudioPlaybackStatsApi {
  underrunDuration = 0;
  underrunEvents = 0;
  totalDuration = 0;
  averageLatency = 0.0319;
  minimumLatency = 0;
  maximumLatency = 0.0372;

  /** Advance as the box's `overload` probe did: whole short callbacks. */
  glitch(events: number, played: number): void {
    this.underrunEvents += events;
    this.underrunDuration += events * EVENT_SECONDS;
    this.totalDuration += played;
  }
}

const host = (stats: AudioPlaybackStatsApi): PlaybackStatsHost => ({ playbackStats: stats });

describe('feature detection (#275 decision 5)', () => {
  it('reports a host with the API', () => {
    expect(hasPlaybackStats(host(new FakeStats()))).toBe(true);
  });

  it('reports null for a browser without it, rather than substituting anything', () => {
    expect(hasPlaybackStats({})).toBe(false);
    expect(hasPlaybackStats(null)).toBe(false);
    expect(hasPlaybackStats(undefined)).toBe(false);
    expect(snapshotPlaybackStats({})).toBeNull();
    expect(snapshotPlaybackStats(null)).toBeNull();
    expect(playbackLatencies(null)).toBeNull();
    expect(playbackWindowDelta(null, null)).toBeNull();
  });

  it('treats a present-but-undefined property as absent', () => {
    // A browser that declares the getter and returns nothing is not a browser
    // with the stats; it is one without them. Built through Object.assign
    // because `exactOptionalPropertyTypes` will not let an optional field be
    // written `undefined` in a literal — which is the shape being tested.
    const declared: PlaybackStatsHost = Object.assign({}, { playbackStats: undefined as unknown as AudioPlaybackStatsApi });
    expect('playbackStats' in declared).toBe(true);
    expect(snapshotPlaybackStats(declared)).toBeNull();
    expect(hasPlaybackStats(declared)).toBe(false);
  });
});

describe('snapshotPlaybackStats', () => {
  it('copies the six fields', () => {
    const stats = new FakeStats();
    stats.glitch(2, 10);
    expect(snapshotPlaybackStats(host(stats))).toEqual({
      underrunDuration: 2 * EVENT_SECONDS,
      underrunEvents: 2,
      totalDuration: 10,
      averageLatency: 0.0319,
      minimumLatency: 0,
      maximumLatency: 0.0372,
    });
  });

  it('detaches from the live object, which is the whole reason it exists', () => {
    // `ctx.playbackStats` is one object per context (`sameObject: true`) whose
    // fields mutate underneath a held reference, so a snapshot that kept the
    // reference would make both ends of an interval read the same numbers.
    const stats = new FakeStats();
    const before = snapshotPlaybackStats(host(stats));
    stats.glitch(5, 1);
    expect(before?.underrunEvents).toBe(0);
    expect(snapshotPlaybackStats(host(stats))?.underrunEvents).toBe(5);
  });
});

describe('playbackWindowDelta', () => {
  it('differences cumulative counters over the window', () => {
    const stats = new FakeStats();
    stats.glitch(4, 30); // before the window
    const open = snapshotPlaybackStats(host(stats));
    stats.glitch(3, 60); // during it
    const close = snapshotPlaybackStats(host(stats));
    const delta = playbackWindowDelta(open, close);
    expect(delta?.underrunEvents).toBe(3);
    expect(delta?.totalDuration).toBe(60);
    expect(delta?.underrunDuration).toBeCloseTo(3 * EVENT_SECONDS, 9);
  });

  it('clamps at zero, so a context replaced mid-window cannot report negative glitches', () => {
    const open = snapshotPlaybackStats(host(Object.assign(new FakeStats(), { underrunEvents: 9 })));
    const close = snapshotPlaybackStats(host(new FakeStats()));
    expect(playbackWindowDelta(open, close)).toEqual({
      underrunEvents: 0,
      underrunDuration: 0,
      totalDuration: 0,
    });
  });
});

describe('boundary fixture: a real zero is not an absence', () => {
  it('reports minimumLatency 0 as 0', () => {
    // It read 0 on every probe read, even after 19 s. Whether that is a stuck
    // first sample is an open question; what must not happen is the reader
    // turning it into "no data".
    const snapshot = snapshotPlaybackStats(host(new FakeStats()));
    expect(snapshot?.minimumLatency).toBe(0);
    expect(playbackLatencies(snapshot)).toEqual({
      averageLatency: 0.0319,
      minimumLatency: 0,
      maximumLatency: 0.0372,
    });
  });
});

describe('boundary fixture: the units of one event', () => {
  it('reads +1 event / +0.0106667 s as one callback of 10.667 ms', () => {
    const delta = { underrunEvents: 1, underrunDuration: EVENT_SECONDS, totalDuration: 60 };
    expect(underrunMsPerEvent(delta)).toBeCloseTo(10.667, 3);
  });

  it('is null over no events — a mean of nothing is undefined, not zero', () => {
    expect(underrunMsPerEvent({ underrunEvents: 0, underrunDuration: 0, totalDuration: 60 })).toBe(
      null,
    );
    expect(underrunMsPerEvent(null)).toBe(null);
  });
});

describe('boundary fixture: a suspended context', () => {
  it('deltas to the output time actually played, not to wall time', () => {
    // `totalDuration` does not advance while suspended (probe `lifetime`), so
    // a window that spans a suspend reports the seconds that were played.
    const stats = new FakeStats();
    const open = snapshotPlaybackStats(host(stats));
    stats.glitch(0, 4); // playing
    // ... suspended for two seconds: nothing advances ...
    stats.glitch(0, 3); // playing again
    const close = snapshotPlaybackStats(host(stats));
    expect(playbackWindowDelta(open, close)?.totalDuration).toBe(7);
  });
});

describe('PlaybackStatsWindow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('honours the settle wait before its closing read', async () => {
    vi.useFakeTimers();
    const stats = new FakeStats();
    const window = new PlaybackStatsWindow(host(stats));
    window.open();
    stats.glitch(90, 1); // the window's own second of overload
    const pending = window.close();
    // The counters keep rising for up to three seconds after the load stops
    // (the box gained 80 events in the second after it); a read taken now
    // would miss them.
    stats.glitch(80, 1);
    await vi.advanceTimersByTimeAsync(AUDIO_STATS_SETTLE_MS);
    expect((await pending)?.window.underrunEvents).toBe(170);
  });

  it('does not settle before the wait is over', async () => {
    vi.useFakeTimers();
    const window = new PlaybackStatsWindow(host(new FakeStats()), { settleMs: 3000 });
    window.open();
    let settled = false;
    void window.close().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it('carries the latencies as they stood at close', async () => {
    const stats = new FakeStats();
    const window = new PlaybackStatsWindow(host(stats), { wait: () => Promise.resolve() });
    window.open();
    stats.maximumLatency = 0.0426; // the box saw exactly this rise once, under load
    expect((await window.close())?.latency.maximumLatency).toBe(0.0426);
  });

  it('deltas correctly even though both reads see the same live object', async () => {
    const stats = new FakeStats();
    const window = new PlaybackStatsWindow(host(stats), { wait: () => Promise.resolve() });
    stats.glitch(11, 20);
    window.open();
    stats.glitch(2, 60);
    const result = await window.close();
    expect(result?.window.underrunEvents).toBe(2);
    expect(result?.window.totalDuration).toBe(60);
    // Floating point: the counters accumulate, so the difference of two sums
    // is only as exact as the sums. `toBeCloseTo` is the assertion a delta of
    // seconds can carry.
    expect(result?.window.underrunDuration).toBeCloseTo(2 * EVENT_SECONDS, 9);
    expect(result?.latency).toEqual({
      averageLatency: 0.0319,
      minimumLatency: 0,
      maximumLatency: 0.0372,
    });
  });

  it('is null on a browser without the API, and on a window that never opened', async () => {
    const absent = new PlaybackStatsWindow({}, { wait: () => Promise.resolve() });
    absent.open();
    expect(absent.available).toBe(false);
    expect(await absent.close()).toBeNull();

    const never = new PlaybackStatsWindow(host(new FakeStats()), { wait: () => Promise.resolve() });
    expect(never.available).toBe(true);
    expect(await never.close()).toBeNull();
  });
});

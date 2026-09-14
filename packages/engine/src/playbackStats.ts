/**
 * `AudioContext.playbackStats` — whether the audio the DSP rendered actually
 * reached the device, and for how long it did not (#275 decision 3).
 *
 * This is the *other* audio number, and it answers a different question from
 * `audioLoad.ts`. That module estimates what the DSP **costs**; this one
 * reports what the output **lost**. A page can be cheap and still glitch (a
 * device buffer starved by something else on the machine), and expensive and
 * still clean.
 *
 * ## What the API is, as probed
 *
 * Chrome 152 on the target box exposes one `AudioPlaybackStats` object per
 * context, with six numeric fields, `resetLatency()` and `toJSON()`
 * (`docs/research/2026-09-14-275-playbackstats-probe/`). What that probe
 * established, and what this module is shaped by:
 *
 * - **One live object, not a snapshot.** `ctx.playbackStats` returns the same
 *   object every time (`sameObject: true`) and its fields mutate underneath a
 *   held reference. A consumer that wants two points in time must **copy**,
 *   which is what `snapshotPlaybackStats` does and why it exists at all.
 * - **Cumulative for the context's life.** Nothing resets the underrun
 *   counters — `suspend()`/`resume()` included — so an interval is a
 *   difference of two snapshots, never a read.
 * - **`totalDuration` is output time.** It holds while the context is
 *   suspended and keeps pace with wall time under overload (including the
 *   silent buffers), so `underrunDuration / totalDuration` is the glitch
 *   fraction of what was actually played.
 * - **Units.** `underrunDuration / underrunEvents` was 0.0106667 s in every
 *   overloaded read: 512 frames at 48 kHz, exactly `baseLatency`. **One event
 *   is one output-device callback delivered short**, not one 128-frame render
 *   quantum, and `underrunDuration` is in seconds.
 * - **It saturates.** At 150 % and at 300 % of the quantum budget the box read
 *   ~90 events/s, which is very nearly every callback. The counters say
 *   whether and for how long audio broke, never by how much.
 * - **About a one-second refresh, with a tail.** See `AUDIO_STATS_SETTLE_MS`:
 *   a window is read after it closes plus a settle wait, which is what
 *   `PlaybackStatsWindow` does.
 *
 * ## Absent is absent
 *
 * Feature-detected with `'playbackStats' in host`, and where it is absent
 * every consumer reports `null` / `n/a` rather than substituting the sampler's
 * estimate (#275 decision 5). The two are different measurements and one is
 * not a stand-in for the other.
 *
 * Everything here is pure over an injected `{ playbackStats? }`-shaped object,
 * so the tests need no browser and no `AudioContext`.
 */
import { AUDIO_STATS_SETTLE_MS } from './audioConstants';

/**
 * The `AudioPlaybackStats` fields this repo reads. Declared here because the
 * TypeScript DOM library does not carry the interface — it is a Chrome
 * surface, not (yet) a baseline one — and `any` would put the six field names
 * beyond the compiler's reach, which is exactly what a reader of an
 * unstandardised API must not do.
 *
 * `resetLatency()` and `toJSON()` are deliberately not modelled: nothing here
 * resets a counter it did not start, and the snapshot is the serialisation.
 */
export interface AudioPlaybackStatsApi {
  /** Seconds of output the device asked for and did not get, for the context's life. */
  readonly underrunDuration: number;
  /** Output-device callbacks that came up short, for the context's life. */
  readonly underrunEvents: number;
  /** Seconds of output played, silent underrun buffers included. Held while suspended. */
  readonly totalDuration: number;
  /** Mean output latency, seconds. */
  readonly averageLatency: number;
  /** Smallest output latency seen, seconds. Read 0 throughout on the box — a real 0, not an absence. */
  readonly minimumLatency: number;
  /** Largest output latency seen, seconds. */
  readonly maximumLatency: number;
}

/** Anything that may carry the API: a live `AudioContext`, or a test double. */
export interface PlaybackStatsHost {
  readonly playbackStats?: AudioPlaybackStatsApi;
}

/**
 * A **detached copy** of the six fields, taken at one instant. The live object
 * mutates, so only a copy can be one end of an interval.
 */
export type PlaybackStatsSnapshot = AudioPlaybackStatsApi;

/** The three counters, differenced over a window (#275 decision 6). */
export interface PlaybackWindowDelta {
  /** Output callbacks that came up short during the window. */
  underrunEvents: number;
  /** Seconds of output those callbacks failed to deliver. */
  underrunDuration: number;
  /** Seconds of output actually played during the window. */
  totalDuration: number;
}

/**
 * The three latencies as they stood when the window closed (#275 decision 4).
 * Not differenced: they are already summaries over the context's life, and a
 * difference of two means is not a mean.
 */
export interface PlaybackLatencies {
  averageLatency: number;
  minimumLatency: number;
  maximumLatency: number;
}

/** What `PlaybackStatsWindow.close()` hands back, or `null` where the API is absent. */
export interface PlaybackWindowResult {
  window: PlaybackWindowDelta;
  latency: PlaybackLatencies;
}

const MS_PER_SECOND = 1000;

/**
 * Read a context as a possible host of the API.
 *
 * `AudioContext` does not declare `playbackStats` in `lib.dom`, and the two
 * types overlap in no field, so the cast goes through `unknown`. It is the
 * single place in the codebase that asserts anything about this API's
 * presence; everywhere else feature-detects through `snapshotPlaybackStats`.
 */
export function asPlaybackStatsHost(context: BaseAudioContext): PlaybackStatsHost {
  return context as unknown as PlaybackStatsHost;
}

/** Does this host carry the API at all? `'playbackStats' in host`, and non-null. */
export function hasPlaybackStats(host: PlaybackStatsHost | null | undefined): boolean {
  return Boolean(host && 'playbackStats' in host && host.playbackStats);
}

/**
 * Copy the six fields out of the live object, or `null` where the API is
 * absent.
 *
 * The copy is the whole point (see the header): the returned object never
 * changes again, which is what makes two of them an interval. A field that is
 * genuinely `0` — `minimumLatency` read 0 on every probe — copies as `0`; only
 * a missing *API* produces `null`.
 */
export function snapshotPlaybackStats(
  host: PlaybackStatsHost | null | undefined,
): PlaybackStatsSnapshot | null {
  if (!host || !('playbackStats' in host)) return null;
  const live = host.playbackStats;
  if (!live) return null;
  return {
    underrunDuration: live.underrunDuration,
    underrunEvents: live.underrunEvents,
    totalDuration: live.totalDuration,
    averageLatency: live.averageLatency,
    minimumLatency: live.minimumLatency,
    maximumLatency: live.maximumLatency,
  };
}

/**
 * The three counters over `[open, close]`.
 *
 * Clamped at zero: the counters only rise for a given context, so a negative
 * difference means the two snapshots came from *different* contexts (a page
 * that rebuilt its audio mid-window), and a negative count of glitches would
 * be a worse lie than a zero one.
 */
export function playbackWindowDelta(
  open: PlaybackStatsSnapshot | null,
  close: PlaybackStatsSnapshot | null,
): PlaybackWindowDelta | null {
  if (!open || !close) return null;
  return {
    underrunEvents: Math.max(0, close.underrunEvents - open.underrunEvents),
    underrunDuration: Math.max(0, close.underrunDuration - open.underrunDuration),
    totalDuration: Math.max(0, close.totalDuration - open.totalDuration),
  };
}

/** The three latencies off a snapshot, or `null` where the API is absent. */
export function playbackLatencies(
  snapshot: PlaybackStatsSnapshot | null,
): PlaybackLatencies | null {
  if (!snapshot) return null;
  return {
    averageLatency: snapshot.averageLatency,
    minimumLatency: snapshot.minimumLatency,
    maximumLatency: snapshot.maximumLatency,
  };
}

/**
 * Milliseconds of output lost per underrun event — the size of one short
 * callback. `null` when nothing underran, because a mean over no events is
 * not zero, it is undefined.
 *
 * On the box this is `baseLatency` in ms (10.667 at 48 kHz), which is how the
 * units finding is stated on screen rather than only in a research folder.
 */
export function underrunMsPerEvent(delta: PlaybackWindowDelta | null): number | null {
  if (!delta || delta.underrunEvents <= 0) return null;
  return (delta.underrunDuration / delta.underrunEvents) * MS_PER_SECOND;
}

const defaultWait = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export interface PlaybackStatsWindowOptions {
  /** Settle wait before the closing read, ms. Defaults to `AUDIO_STATS_SETTLE_MS`. */
  settleMs?: number;
  /** How the wait is taken. Injected so a test can drive it with fake timers or none at all. */
  wait?: (ms: number) => Promise<void>;
}

/**
 * One measured window's worth of playback stats: snapshot at open, wait out
 * the counters' tail, snapshot at close, difference (#275 decision 6).
 *
 * `open()` is synchronous and cheap — it is called on the frame the bench
 * window opens. `close()` is where the settle wait is taken, so a caller that
 * wants the window's real tail must await it before it reports.
 */
export class PlaybackStatsWindow {
  private opened: PlaybackStatsSnapshot | null = null;
  private readonly settleMs: number;
  private readonly wait: (ms: number) => Promise<void>;

  constructor(
    private readonly host: PlaybackStatsHost | null,
    options: PlaybackStatsWindowOptions = {},
  ) {
    this.settleMs = options.settleMs ?? AUDIO_STATS_SETTLE_MS;
    this.wait = options.wait ?? defaultWait;
  }

  /** Whether this window can report anything at all — i.e. whether the API is here. */
  get available(): boolean {
    return hasPlaybackStats(this.host);
  }

  /** Snapshot the counters as the window opens. */
  open(): void {
    this.opened = snapshotPlaybackStats(this.host);
  }

  /**
   * Wait out the settle, snapshot again and difference. `null` where the API
   * is absent, and where `open()` was never called — a window that was never
   * opened has no interval, which is not the same as an interval of zero.
   */
  async close(): Promise<PlaybackWindowResult | null> {
    const open = this.opened;
    if (!open) return null;
    await this.wait(this.settleMs);
    const closed = snapshotPlaybackStats(this.host);
    const window = playbackWindowDelta(open, closed);
    const latency = playbackLatencies(closed);
    if (!window || !latency) return null;
    return { window, latency };
  }
}

/**
 * Two readings of whether the render is losing, both taken on the main thread
 * for free (windsor#794). The duty-cycle sampler in `audioLoad.ts` times only
 * the inside of each processor's `process()`, so it cannot see Chrome's
 * per-node, per-parameter or scheduling work: the performance assessment
 * (`docs/research/2026-10-13-performance-assessment/`) read 65 % on it while
 * the audio thread ran at 317 % of real time. These two see the result
 * instead of the parts:
 *
 * - **The audio clock's rate.** Over each report interval, the change in
 *   `context.currentTime` over the change in `performance.now()`. A render
 *   that keeps up advances its clock at 1.0; one that falls behind advances
 *   it slower (`2026-10-01-automation-param-cost` used exactly this reading).
 * - **The device's underruns.** `AudioContext.playbackStats.underrunEvents`
 *   where the browser has it (the #275 probe found it on the target box's
 *   Chrome). Feature-detected on the context, never assumed.
 */
import { AUDIO_LOAD_REPORT_SECONDS } from '../audioConstants';

const MS_PER_SECOND = 1000;

/** The slice of a context the clock reads. */
export interface ClockSource {
  readonly currentTime: number;
  readonly state: AudioContextState;
}

interface Anchor {
  audioSeconds: number;
  wallMs: number;
}

/**
 * The audio clock's rate over the last whole report interval. `read()` is
 * called as often as the console likes; the rate moves once per interval.
 * Null until a whole interval has passed, and while the context is not
 * running (a suspended clock is stopped on purpose, not losing). `now` is
 * injected so the tests can drive a fake clock.
 */
export class AudioClockRate {
  private anchor: Anchor | null = null;
  private rate: number | null = null;

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly intervalSeconds = AUDIO_LOAD_REPORT_SECONDS,
  ) {}

  read(source: ClockSource): number | null {
    if (source.state !== 'running') {
      this.anchor = null;
      this.rate = null;
      return null;
    }
    const wallMs = this.now();
    const audioSeconds = source.currentTime;
    if (!this.anchor) {
      this.anchor = { audioSeconds, wallMs };
      return this.rate;
    }
    const elapsedSeconds = (wallMs - this.anchor.wallMs) / MS_PER_SECOND;
    if (elapsedSeconds >= this.intervalSeconds) {
      this.rate = (audioSeconds - this.anchor.audioSeconds) / elapsedSeconds;
      this.anchor = { audioSeconds, wallMs };
    }
    return this.rate;
  }
}

/** `AudioPlaybackStats`, which only some browsers have; every field optional. */
interface PlaybackStatsLike {
  readonly underrunEvents?: number;
}

/**
 * The device's cumulative underrun count, held monotone: a count that a
 * browser resets or misreports never falls on screen. Null for good on a
 * context without `playbackStats`.
 */
export class DeviceUnderruns {
  private seen = 0;

  read(context: object): number | null {
    const stats = (context as { playbackStats?: PlaybackStatsLike }).playbackStats;
    const events = stats?.underrunEvents;
    if (typeof events !== 'number' || !Number.isFinite(events)) return null;
    if (events > this.seen) this.seen = events;
    return this.seen;
  }
}

/**
 * What the audio scheduler costs on the **main** thread (#275 decision 7).
 *
 * `systems.ts` runs `audio.update(dt)` in `FRAME_SYSTEMS` every frame, so the
 * look-ahead pump's cost has been inside every milestone reading taken so far,
 * unattributed (the 2026-09-05 audit's finding C13). This meter attributes it:
 * the audio system times its own `update()` and pushes the millisecond figure
 * here, and the overlay and the bench read it back.
 *
 * It is a **rolling window**, not a lifetime mean: `AUDIO_SCHED_WINDOW_SECONDS`
 * of samples, the same second the worklets report their DSP load over, so the
 * overlay's two audio numbers describe the same slice of wall time. The bench
 * does not read the mean at all — it samples `lastMs` per frame and takes its
 * own distribution over the measured window, which is the honest way to get a
 * p95 over 60 s rather than a p95 of rolling p95s.
 *
 * `docs/design/audio-architecture.md` §7 wants "audio scheduling under 0.5 ms
 * of main-thread time per frame at p95". This is the number that criterion
 * will be read from; nothing here votes on a verdict.
 */
import {
  AUDIO_SCHED_MAX_SAMPLES,
  AUDIO_SCHED_QUANTILE,
  AUDIO_SCHED_WINDOW_SECONDS,
} from './audioConstants';

const MS_PER_SECOND = 1000;

/** The main-thread scheduling cost over the rolling window. */
export interface SchedCostReadout {
  /** The most recent frame's cost, ms — what the bench samples per frame. */
  lastMs: number;
  /** Mean cost per frame over the window, ms. */
  meanMs: number;
  /** Nearest-rank p95 over the window, ms — §7's criterion. */
  p95Ms: number;
  /** Frames in the window. Zero means nothing has been timed yet. */
  frames: number;
}

export const ZERO_SCHED_COST: SchedCostReadout = {
  lastMs: 0,
  meanMs: 0,
  p95Ms: 0,
  frames: 0,
};

export interface SchedCostMeterOptions {
  /** The rolling window, seconds. Defaults to `AUDIO_SCHED_WINDOW_SECONDS`. */
  windowSeconds?: number;
  /** Hard cap on held samples. Defaults to `AUDIO_SCHED_MAX_SAMPLES`. */
  maxSamples?: number;
  /** Wall clock, injected so the tests can age a sample without sleeping. */
  now?: () => number;
}

/**
 * Per-frame costs over a rolling window.
 *
 * Two parallel arrays rather than an array of objects: one sample a frame for
 * a second is at most a few hundred entries, and the pruning is a splice off
 * the front of each, so nothing here allocates per frame beyond the two
 * pushes.
 */
export class SchedCostMeter {
  private readonly ms: number[] = [];
  private readonly at: number[] = [];
  private readonly windowMs: number;
  private readonly maxSamples: number;
  private readonly now: () => number;

  constructor(options: SchedCostMeterOptions = {}) {
    this.windowMs = (options.windowSeconds ?? AUDIO_SCHED_WINDOW_SECONDS) * MS_PER_SECOND;
    this.maxSamples = options.maxSamples ?? AUDIO_SCHED_MAX_SAMPLES;
    this.now = options.now ?? ((): number => performance.now());
  }

  /** Record one frame's scheduling cost, in milliseconds. */
  sample(ms: number): void {
    const now = this.now();
    this.ms.push(ms);
    this.at.push(now);
    const cutoff = now - this.windowMs;
    let drop = 0;
    while (drop < this.at.length && (this.at[drop] as number) < cutoff) drop++;
    // The cap is the backstop for a clock that has stopped advancing: pruning
    // by age alone would then never drop anything.
    if (this.ms.length - drop > this.maxSamples) drop = this.ms.length - this.maxSamples;
    if (drop > 0) {
      this.ms.splice(0, drop);
      this.at.splice(0, drop);
    }
  }

  /**
   * Mean and nearest-rank p95 over the window. The percentile method is the
   * bench's (`bench/summary.ts`'s `percentile`), and `schedCost.test.ts` pins
   * the two to agree so the overlay's p95 and a bench line's p95 cannot drift
   * apart.
   */
  readout(): SchedCostReadout {
    const frames = this.ms.length;
    if (frames === 0) return ZERO_SCHED_COST;
    let sum = 0;
    for (const v of this.ms) sum += v;
    const sorted = [...this.ms].sort((a, b) => a - b);
    const rank = Math.min(frames, Math.max(1, Math.ceil(AUDIO_SCHED_QUANTILE * frames)));
    return {
      lastMs: this.ms[frames - 1] as number,
      meanMs: sum / frames,
      p95Ms: sorted[rank - 1] as number,
      frames,
    };
  }

  /** Drop every held sample — a system that stopped scheduling reports nothing, not stale numbers. */
  reset(): void {
    this.ms.length = 0;
    this.at.length = 0;
  }
}

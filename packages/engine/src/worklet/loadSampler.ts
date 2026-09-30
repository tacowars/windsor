/**
 * The audio-load sampler every worklet processor runs (#445, windsor#214): off
 * until a `reportLoad` message turns it on, then the `Date.now()` span of each
 * render, summed, and posted every `quanta` renders in one reused
 * `LoadReportMessage`. `cost/audioLoad.ts` says what the numbers are worth and
 * why they are millisecond crossings, not durations.
 *
 * One class, bundled into each processor, so the ten samplers cannot drift
 * apart. A processor calls `begin()` before its render and `end(frames)` after
 * it; both do nothing while the meter is off. The readings live in the
 * sampler's own fields, so no reading is passed across a call, and every time
 * field is first written as a double (NaN until `start` sets it), so V8 never
 * generalises one from a small integer, which would deprecate the object's
 * map and deoptimise the render that reads it (worklet rule 7).
 *
 * What still allocates while the meter reads: each `Date.now()` returns a new
 * heap number, 16 bytes, two a quantum. Optimised code calls the runtime's
 * `DateCurrentTime`, whose result is a tagged value; no source form stores the
 * reading without it (`docs/research/2026-09-30-load-sampler-allocation/`).
 * Off, the sampler allocates nothing. Pinned by
 * `cost/loadSamplerAllocation.test.ts` and `cost/audioLoad.test.ts`.
 *
 * It compiles in the engine's project and in each worklet project that
 * bundles it, so its fields are `declare`d: they emit nothing under either
 * project's class-field semantics.
 */
import type { LoadReportMessage } from '../synth/workletMessages';

const LOAD_MS_PER_SECOND = 1000;

interface ReportPort {
  postMessage(message: LoadReportMessage): void;
}

class LoadSampler {
  /** Renders per report; 0 is the meter off. */
  declare quanta: number;
  /** This render's start, `Date.now()`. */
  declare startMs: number;
  /** This interval's start, `Date.now()`. */
  declare wallStartMs: number;
  declare rate: number;
  declare port: ReportPort;
  /** The one report, reused: the port clones what it posts. */
  declare report: LoadReportMessage;

  constructor(rate: number, port: ReportPort) {
    this.quanta = 0;
    this.startMs = NaN;
    this.wallStartMs = NaN;
    this.rate = rate;
    this.port = port;
    this.report = { type: 'load', busyMs: NaN, wallMs: NaN, quanta: 0, peakMs: NaN, underruns: 0 };
  }

  /**
   * A `reportLoad` message: start (or restart) at `quanta` renders a report,
   * or stop at 0. The cumulative underrun count survives a restart; the
   * interval's counters do not.
   */
  start(quanta: number): void {
    const report = this.report;
    this.quanta = Math.max(0, quanta | 0);
    report.busyMs = report.quanta = report.peakMs = 0;
    this.wallStartMs = Date.now();
  }

  /** Before the render. */
  begin(): void {
    if (this.quanta !== 0) this.startMs = Date.now();
  }

  /**
   * After a render of `frames`: the span's millisecond crossings, and the post
   * once the interval is full. The span is not a duration: N crossings prove
   * only that the render took more than N − 1 ms (a 2.2 ms quantum from
   * 1000.9 to 1003.1 crosses three), so only `span − 1` may count a missed
   * deadline (#445 review, passes 1 and 2).
   */
  end(frames: number): void {
    if (this.quanta === 0) return;
    const now = Date.now();
    const elapsed = now - this.startMs;
    const report = this.report;
    report.busyMs += elapsed;
    report.peakMs = Math.max(report.peakMs, elapsed);
    if (elapsed - 1 >= (frames / this.rate) * LOAD_MS_PER_SECOND) report.underruns++;
    if (++report.quanta < this.quanta) return;
    report.wallMs = now - this.wallStartMs;
    this.port.postMessage(report);
    report.busyMs = report.quanta = report.peakMs = 0;
    this.wallStartMs = now;
  }
}

export { LoadSampler };

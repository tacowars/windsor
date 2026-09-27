/**
 * What the music costs on the audio thread (#445).
 *
 * The frame collector cannot see the audio rendering thread at all, so the DSP
 * reports its own cost: each worklet processor accumulates counters inside
 * `process()` and posts them once per report interval, and this module sums
 * the live ones into one `AudioLoadReadout` for `AudioSystem.readout()`.
 *
 * ## What the numbers are worth
 *
 * The ticket asked for the first usable of three measurement paths. Probed on
 * this machine's Chrome 152 (`docs/research/2026-09-11-445-audio-bench-arm/`,
 * `probe.mjs`):
 *
 *   (a) `AudioContext.renderCapacity` — **absent**, and absent under
 *       `--enable-experimental-web-platform-features` too.
 *   (b) `performance.now()` inside `AudioWorkletGlobalScope` — **absent**
 *       (`typeof performance === 'undefined'`).
 *   (c) so: `Date.now()`, the only clock that scope has, at 1 ms resolution
 *       against a 2.9 ms quantum budget at 44.1 kHz.
 *
 * One millisecond cannot time one quantum, so the processor does not try. It
 * **samples a duty cycle**: it reads `Date.now()` either side of its render
 * and adds the difference, which is the number of integer-millisecond
 * boundaries that fell inside the call. Boundaries arrive at a fixed rate in
 * wall time, so counting the ones that land inside `process()` and dividing by
 * the interval's wall milliseconds estimates the fraction of wall time the
 * audio thread spent in that processor — the DSP load.
 *
 * It is an estimator, and the record says so. Calibrated against synthetic
 * loads of known duration (probe stage 2, same folder) it reads 0 % at rest
 * and tracks the true load monotonically, over-reading it by roughly 2–3×
 * because the audio thread renders in bursts and the boundaries inside a burst
 * are not uniformly distributed over the call. So: an `loadPct` of 0 means
 * nothing measurable, a single-digit reading means the music is cheap, and a
 * reading near 100 means the audio thread is in trouble. It is not a
 * two-significant-figure cost, and no gate votes on it (#445 decision: the
 * verdict stays the three frame gates).
 *
 * `underruns` is the firmest number this readout has, and it is firm only
 * because it is deliberately conservative: a lower bound on deadline misses
 * inside the DSP, not a count of what the output device failed to play. N
 * boundary crossings prove the
 * render took **more than N − 1 ms** — nothing about N itself — so a 2.2 ms
 * quantum that happens to straddle three boundaries must not be accused of
 * missing a 2.902 ms deadline. The processors therefore count an underrun
 * only when `span − 1` reaches the whole budget, which under-counts real
 * overruns by up to a millisecond's worth and never invents one. `peakPct`
 * is scaled the same way below, which is what makes it the lower bound it
 * claims to be. Reported, never a gate — whether it *should* gate is argued
 * in the first target reading's record.
 */
import { AUDIO_LOAD_STALE_MS, RENDER_QUANTUM_FRAMES } from '../audioConstants';
import type { LoadReportMessage } from '../synth/workletMessages';

const PERCENT = 100;
const MS_PER_SECOND = 1000;
/**
 * `Date.now()`'s granularity, and therefore the uncertainty on every span the
 * processors measure: a span of N crossings proves `N - 1` ms of work and no
 * more. Subtracted wherever a number claims to be a floor.
 */
const CLOCK_RESOLUTION_MS = 1;

/**
 * The audio thread's cost, as `AudioSystem.loadReadout()` reports it.
 * All four fields are zero on a page with no audio, and on one whose
 * processors have not reported yet.
 */
export interface AudioLoadReadout {
  /**
   * DSP load over the last report interval, summed across processors, as a
   * percentage of wall time. See the header: an estimator that over-reads.
   */
  loadPct: number;
  /**
   * The worst single quantum any processor measured in that interval, as a
   * percentage of the quantum budget — a **lower bound**, because a span of N
   * boundary crossings proves only `N − 1` ms of work. So a quantum measured
   * at 1 ms reads 0 % (it proves nothing), 2 ms reads ~34 % at 44.1 kHz, and
   * the number never overstates what the DSP took.
   */
  peakPct: number;
  /**
   * Quanta whose provable duration reached the whole budget — a deadline miss
   * that cannot be an artefact of the clock. Cumulative across every processor
   * this meter has ever attached, and **monotone**: it never falls because a
   * processor went quiet (see `readout()`).
   */
  underruns: number;
  /** How many processors reported in the interval just read. */
  processors: number;
}

export const ZERO_AUDIO_LOAD: AudioLoadReadout = {
  loadPct: 0,
  peakPct: 0,
  underruns: 0,
  processors: 0,
};

/**
 * Turn the sampler on in one node's processor, if it has one.
 *
 * Duck-typed on `port` rather than `instanceof AudioWorkletNode`: the delay
 * return is a native `DelayNode` with no processor to ask, and the headless
 * test stand-in (`__fixtures__/fakeAudioContext.ts`) defines no such global.
 */
export function meterNode(
  meter: AudioLoadMeter,
  id: string,
  node: AudioNode,
  sampleRate: number,
  seconds: number,
): void {
  const { port } = node as AudioNode & { port?: MessagePort };
  if (!port) return;
  meter.attach(id, port, reportQuanta(sampleRate, seconds), sampleRate);
}

/** Milliseconds one render quantum has to be produced in, at this sample rate. */
export function quantumBudgetMs(sampleRate: number): number {
  return (RENDER_QUANTUM_FRAMES / sampleRate) * MS_PER_SECOND;
}

/** Render quanta in `seconds` of audio at this sample rate — the processor's report cadence. */
export function reportQuanta(sampleRate: number, seconds: number): number {
  return Math.max(1, Math.round((seconds * sampleRate) / RENDER_QUANTUM_FRAMES));
}

interface Entry {
  report: LoadReportMessage;
  at: number;
}

/**
 * Collects the processors' reports and sums them.
 *
 * One meter per `AudioSystem`. `attach()` wires a node's port and turns its
 * sampler on; the node keeps posting until it is disposed, and a processor
 * that stops posting drops out after `AUDIO_LOAD_STALE_MS` rather than
 * freezing its last number on screen.
 *
 * `now` is injected so the tests can age a report without sleeping.
 */
export class AudioLoadMeter {
  private readonly entries = new Map<string, Entry>();
  private readonly sampleRates = new Map<string, number>();
  private readonly attached = new Set<string>();
  /** The port currently authoritative for each id, so a replacement can silence the old one. */
  private readonly ports = new Map<string, MessagePort>();
  /**
   * Cumulative underruns per id, monotone. Held apart from `entries` because
   * the two have opposite lifetimes: instantaneous load must expire when a
   * processor goes quiet, and a count of deadline misses must not — the window
   * that suffered them still suffered them (#445 review, pass 2).
   */
  private readonly underrunTotals = new Map<string, number>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Processors this meter has turned reporting on in — not how many have reported. */
  get processorCount(): number {
    return this.attached.size;
  }

  /**
   * Turn the sampler on in one processor and collect what it posts. `id` is
   * the processor's name in the readout's own bookkeeping (the part name, or
   * the return's); attaching the same id twice replaces the first.
   */
  attach(id: string, port: MessagePort, quanta: number, sampleRate: number): void {
    // Replacement means replacement: the previous port's handler is detached
    // first, or a node that is still alive keeps overwriting its successor's
    // reports under the same id (#445 review, pass 2).
    const previous = this.ports.get(id);
    if (previous && previous !== port) previous.onmessage = null;
    this.attached.add(id);
    this.ports.set(id, port);
    port.onmessage = (event: MessageEvent): void => {
      const data = event.data as LoadReportMessage | undefined;
      if (data?.type === 'load') this.accept(id, data, sampleRate);
    };
    port.postMessage({ type: 'reportLoad', quanta });
  }

  /**
   * Forget a processor that is being disposed (#629): its port is silenced and
   * its instantaneous entry dropped, so `processorCount` and the load stop
   * counting it now rather than after the stale window. Its underruns stay —
   * a window that suffered them still suffered them.
   */
  detach(id: string): void {
    const port = this.ports.get(id);
    if (port) port.onmessage = null;
    this.ports.delete(id);
    this.attached.delete(id);
    this.entries.delete(id);
    this.sampleRates.delete(id);
  }

  /**
   * Take one report. Public because the unit tests drive the meter directly.
   *
   * The processor reports its underruns cumulatively, so the total kept here
   * only ever rises: a replacement processor starts its own count at zero, and
   * taking the larger of the two keeps the misses the old one really had.
   */
  accept(id: string, report: LoadReportMessage, sampleRate: number): void {
    this.entries.set(id, { report, at: this.now() });
    this.sampleRates.set(id, sampleRate);
    const seen = this.underrunTotals.get(id) ?? 0;
    if (report.underruns > seen) this.underrunTotals.set(id, report.underruns);
  }

  /**
   * Sum the live reports. `loadPct` divides the processors' summed busy
   * milliseconds by the **longest** interval any of them covered — they all
   * run on the same thread over the same wall time, and the longest is the
   * conservative denominator.
   *
   * The three instantaneous fields read only processors that are still
   * reporting, so a disposed part stops inflating the load. `underruns` is the
   * exception and reads every id ever attached: a count of deadline misses is
   * history, and a window that suffered seven must not report zero because the
   * processor fell silent afterwards.
   */
  readout(): AudioLoadReadout {
    const cutoff = this.now() - AUDIO_LOAD_STALE_MS;
    let busyMs = 0;
    let wallMs = 0;
    let peakPct = 0;
    let processors = 0;
    for (const [id, entry] of this.entries) {
      if (entry.at < cutoff) continue;
      const { report } = entry;
      processors++;
      busyMs += report.busyMs;
      if (report.wallMs > wallMs) wallMs = report.wallMs;
      const budget = quantumBudgetMs(this.sampleRates.get(id) ?? 0);
      // `peakMs - 1` is what the crossing count proves; see the header.
      const provenMs = Math.max(0, report.peakMs - CLOCK_RESOLUTION_MS);
      const pct = budget > 0 ? (provenMs / budget) * PERCENT : 0;
      if (pct > peakPct) peakPct = pct;
    }
    let underruns = 0;
    for (const total of this.underrunTotals.values()) underruns += total;
    return {
      loadPct: wallMs > 0 ? (busyMs / wallMs) * PERCENT : 0,
      peakPct,
      underruns,
      processors,
    };
  }

  /** Stop collecting; the ports themselves are closed by whoever disposes the nodes. */
  dispose(): void {
    for (const port of this.ports.values()) port.onmessage = null;
    this.ports.clear();
    this.entries.clear();
    this.sampleRates.clear();
    this.attached.clear();
    this.underrunTotals.clear();
  }
}

/** windsor#211 research processor, never imported by the app: one stereo Tape instance on
 * the program input. Legacy is the phase-2 TapeDsp at the pinned baseline; the others
 * wrap the raw GPL-3.0-only CHOW-derived research core (upstream 604372e, no knee policy)
 * in the phase-3 or symmetric resampler. Date.now is telemetry only, read only in
 * real-time trials; the offline render is timed from the page. Storage is fixed at
 * construction; process() allocates nothing.
 */
/* global AudioWorkletProcessor, sampleRate, currentFrame, registerProcessor */
import { ResampledHysteresis } from '../2026-09-30-tape-phase-3/resampler';
import { SymmetricResampledHysteresis } from '../2026-09-30-tape-resampler/symmetric';
import { COST } from './costConstants';
import { TapeDsp } from '../../../packages/engine/src/worklet/tape/tapeDsp';
import { TAPE_DEFAULTS } from '../../../packages/engine/src/inserts/tapeConstants';

const QUANTUM_MS = (COST.quantumFrames / COST.rate) * 1000;

class CostProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { configuration: c, edits, realtime, frames } = options.processorOptions;
    Object.assign(this, { c, edits, realtime, frames, quanta: 0, nonfinite: 0 });
    this.params = Object.fromEntries(
      Object.entries({ ...TAPE_DEFAULTS, model: 0 }).map(([k, v]) => [
        k,
        new Float32Array([Number(v)]),
      ]),
    );
    this.legacy = c.legacy ? new TapeDsp(sampleRate, this.params) : null;
    const Dsp = c.symmetric ? SymmetricResampledHysteresis : ResampledHysteresis,
      settings = { rate: sampleRate, factor: c.factor, span: c.span };
    [this.left, this.right] = c.legacy
      ? [null, null]
      : [0, 1].map(() => new Dsp({ ...settings, solver: c.solver, identity: !!c.identity }));
    this.silence = new Float32Array(COST.quantumFrames);
    const R = COST.realtime,
      batches = Math.floor(R.measuredQuanta / R.batchQuanta);
    this.counters = { busyMs: 0, peakMs: 0, underruns: 0, quanta: 0, startMs: 0, wallMs: 0 };
    this.batch = { startMs: 0, busyMs: 0, count: 0, wallMs: new Float64Array(batches) };
    this.batch.busy = new Float64Array(batches);
  }
  /** Phase 3's schedule: every `quanta` quanta, alternate high and low drive. */
  edit(frames) {
    const E = COST.edits;
    if (this.edits && this.quanta % E.quanta === 0) {
      const drive = this.quanta % (2 * E.quanta) ? E.low : E.high;
      if (this.legacy) this.params.drive[0] = drive * E.legacyDriveScale;
      else {
        this.left.core.configure(drive, 0.5, 0.5);
        this.right.core.configure(drive, 0.5, 0.5);
      }
    }
    if (this.legacy) this.legacy.configure(this.params, frames);
  }
  render(input, out) {
    const inL = input[0] ?? this.silence,
      inR = input[1] ?? inL,
      [outL, outR] = out;
    for (let i = 0; i < outL.length; i++) {
      if (this.legacy) {
        this.legacy.tick(inL[i], inR[i]);
        outL[i] = this.legacy.left;
        outR[i] = this.legacy.right;
      } else {
        outL[i] = this.left.tick(inL[i]);
        outR[i] = this.right.tick(inR[i]);
      }
      if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) this.nonfinite++;
    }
  }
  process(inputs, outputs) {
    const start = this.realtime ? Date.now() : 0,
      out = outputs[0];
    this.edit(out[0].length);
    this.render(inputs[0], out);
    if (this.realtime) this.count(start, Date.now());
    else if (currentFrame + COST.quantumFrames >= this.frames) this.final();
    this.quanta++;
    return true;
  }
  /** Phase 3's boundary counters, and the batched counter over `batchQuanta` calls. */
  count(start, end) {
    const R = COST.realtime,
      k = this.counters,
      b = this.batch,
      measured = this.quanta - R.warmupQuanta;
    if (measured < 0 || measured > R.measuredQuanta) return;
    if (measured % R.batchQuanta === 0) {
      if (measured > 0 && b.count < b.wallMs.length) {
        b.wallMs[b.count] = start - b.startMs;
        b.busy[b.count++] = b.busyMs;
      }
      b.startMs = start;
      b.busyMs = 0;
    }
    if (measured === 0) {
      k.startMs = start;
      this.port.postMessage({ type: 'warm' });
    }
    if (measured === R.measuredQuanta) return this.report(start);
    const elapsed = end - start;
    k.busyMs += elapsed;
    b.busyMs += elapsed;
    k.peakMs = Math.max(k.peakMs, elapsed);
    if (elapsed - 1 >= QUANTUM_MS) k.underruns++;
    k.quanta++;
  }
  core() {
    const sides = this.legacy ? [] : [this.left.core, this.right.core];
    return {
      resets: sides.reduce((n, s) => n + s.resets, 0),
      clips: sides.reduce((n, s) => n + s.clips, 0),
      nonfinite: this.nonfinite,
    };
  }
  report(now) {
    const { startMs, ...counters } = this.counters;
    this.port.postMessage({
      type: 'report',
      ...counters,
      wallMs: now - startMs,
      batches: { wallMs: Array.from(this.batch.wallMs), busyMs: Array.from(this.batch.busy) },
      performanceAvailable: typeof performance !== 'undefined',
      ...this.core(),
    });
  }
  final() {
    this.port.postMessage({ type: 'final', quanta: this.quanta + 1, ...this.core() });
  }
}
registerProcessor('tape-cost', CostProcessor);

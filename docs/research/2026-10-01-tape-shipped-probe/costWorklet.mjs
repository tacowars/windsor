/** windsor#250 cost processor, never imported by the app: the shipped Tape processor from
 * the generated bundle, byte for byte, with #211's counters around its `process`. The
 * bundle's text is evaluated here with `registerProcessor` captured, as the engine's
 * `__fixtures__/tapeHarness.ts` evaluates it in Node, so the class that runs is the one the
 * app loads. #211's worklet cannot be reused: it wraps the research cores. Date.now is
 * telemetry only, read only in real-time trials; the offline render is timed from the page.
 */
/* global currentFrame, registerProcessor */
import shipped from '../../../packages/engine/src/worklet/generated/tape-processor.js';
import { SHIPPED } from './probeConstants';

let Shipped;
new Function('registerProcessor', shipped)((_name, processor) => (Shipped = processor));
const QUANTUM_MS = (SHIPPED.quantumFrames / SHIPPED.rate) * 1000;

class ShippedCost extends Shipped {
  constructor(options) {
    super(options);
    const { realtime, frames } = options.processorOptions;
    Object.assign(this, { realtime, frames, quanta: 0, nonfinite: 0 });
    const R = SHIPPED.realtime,
      batches = Math.floor(R.measuredQuanta / R.batchQuanta);
    this.counters = { busyMs: 0, peakMs: 0, underruns: 0, quanta: 0, startMs: 0, wallMs: 0 };
    this.batch = { startMs: 0, busyMs: 0, count: 0, wallMs: new Float64Array(batches) };
    this.batch.busy = new Float64Array(batches);
  }
  process(inputs, outputs, params) {
    const start = this.realtime ? Date.now() : 0,
      [left, right] = outputs[0];
    super.process(inputs, outputs, params);
    for (let i = 0; i < left.length; i++)
      if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) this.nonfinite++;
    if (this.realtime) this.count(start, Date.now());
    else if (currentFrame + SHIPPED.quantumFrames >= this.frames) this.final();
    this.quanta++;
    return true;
  }
  /** #211's boundary counters, and its batched counter over `batchQuanta` calls. */
  count(start, end) {
    const R = SHIPPED.realtime,
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
  /** Both channels' cores at both factors, and the factor the DSP actually selected. */
  core() {
    const m = this.dsp.magnetic;
    return {
      factor: m.factor,
      resets: m.oversamplers.reduce((n, o) => n + o.core.resets, 0),
      guards: m.oversamplers.reduce((n, o) => n + o.guards, 0),
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
registerProcessor('tape-shipped-cost', ShippedCost);

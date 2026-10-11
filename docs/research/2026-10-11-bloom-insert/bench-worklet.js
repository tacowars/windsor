/* global AudioWorkletProcessor, registerProcessor, sampleRate, performance */
// Real-time bench: one Bloom kernel per node. Warm up one quantum a call, calibrate with a 20 ms
// chunk, then run K quanta a call (K sized to about half the quantum) for `calls` calls, summing each
// call's Date.now() crossings (an unbiased estimate of the mean, as Windsor's load sampler). Finally a
// 50 ms timed chunk as a cross-check. Reports ms per quantum of kernel work.
import { Bloom } from './bloom-kernels.js';
class Bench extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const c = o.processorOptions;
    this.k = new Bloom(sampleRate, c);
    this.qms = 128000 / sampleRate;
    this.warm = c.warm; this.target = c.calls;
    this.stage = 0; this.calls = 0; this.K = 1; this.busy = 0; this.over = 0;
    this.cal = NaN; this.cal = 0;
    this.hasPerf = typeof performance !== 'undefined' && performance && typeof performance.now === 'function';
  }
  process(inputs, outputs) {
    const k = this.k;
    if (this.stage === 0) {
      k.quantum();
      if (++this.calls >= this.warm) {
        const t0 = Date.now(); let n = 0;
        do { k.quantum(); n++; } while (Date.now() - t0 < 20);
        this.cal = (Date.now() - t0) / n;
        this.K = Math.max(1, Math.min(4096, Math.floor((0.5 * this.qms) / this.cal)));
        this.stage = 1; this.calls = 0;
      }
    } else if (this.stage === 1) {
      const K = this.K, t0 = Date.now();
      for (let q = 0; q < K; q++) k.quantum();
      const d = Date.now() - t0;
      this.busy += d; if (d >= 2 * this.qms) this.over++;
      if (++this.calls >= this.target) {
        const t1 = Date.now(); let n = 0;
        do { k.quantum(); n++; } while (Date.now() - t1 < 50);
        const burst = (Date.now() - t1) / n;
        this.port.postMessage({ cal: this.cal, K, calls: this.calls, msPerQ: this.busy / (this.calls * K), burst, callsOver2q: this.over, hasPerf: this.hasPerf, flags: k.flag[16] });
        this.stage = 2;
      }
    }
    const out = outputs[0] && outputs[0][0];
    if (out) { const L = k.outL; for (let i = 0; i < 128; i++) out[i] = 0 * L[i]; }
    return true;
  }
}
registerProcessor('bloom-bench', Bench);

/** windsor#533 decision 4, research only: one meter node with an input per part, reporting
 * every part in one message. Each input runs the shipped processor's per-sample loop
 * (`packages/engine/src/worklet/meter/peakMeterProcessor.ts`) unchanged in shape, on its
 * own slice of scalar state, and the node posts one Float32Array of every part's report at
 * the shipped rate. An input with nothing connected and nothing held is skipped. It
 * allocates nothing in `process` beyond the post's own clone, as the shipped one.
 */
/* global AudioWorkletProcessor, registerProcessor, sampleRate */
import { PEAK_METER } from '../../../packages/engine/src/mixer/peakMeterConstants.ts';
import { MULTI_METER } from './benchConstants.mjs';

const F = MULTI_METER.fields;
const [LEFT, RIGHT, HOLD_LEFT, HOLD_RIGHT, OVERLOAD] = [0, 1, 2, 3, 4];

class MultiPeakMeterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.parts = options.numberOfInputs;
    this.running = true;
    this.frames = 0;
    this.holds = new Float64Array(this.parts * 2);
    this.report = new Float32Array(this.parts * F);
    this.port.onmessage = ({ data }) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reset') {
        const p = this.report,
          o = data.part * F;
        p[o + OVERLOAD] = p[o + HOLD_LEFT] = p[o + HOLD_RIGHT] = 0;
        this.holds[data.part * 2] = this.holds[data.part * 2 + 1] = 0;
      }
    };
  }
  process(inputs, outputs) {
    if (!this.running) return false;
    const count = outputs[0]?.[0]?.length ?? 0,
      p = this.report;
    for (let k = 0; k < this.parts; k++) {
      const o = k * F;
      if (inputs[k].length === 0 && p[o + HOLD_LEFT] === 0 && p[o + HOLD_RIGHT] === 0) continue;
      this.part(k, inputs[k], count);
    }
    this.frames += count;
    if (this.frames >= sampleRate / PEAK_METER.reportHz) {
      this.port.postMessage(p);
      this.frames = 0;
      for (let k = 0; k < this.parts; k++) p[k * F + LEFT] = p[k * F + RIGHT] = 0;
    }
    return true;
  }
  /** The shipped loop, on part k's slice of the report and its two hold countdowns. */
  part(k, input, count) {
    const l = input[0],
      r = input[1] ?? l,
      p = this.report,
      h = this.holds,
      o = k * F,
      hl = k * 2,
      hr = hl + 1;
    for (let i = 0; i < count; i++) {
      const left = Math.abs(l?.[i] ?? 0);
      const right = Math.abs(r?.[i] ?? 0);
      p[o + LEFT] = Math.max(p[o + LEFT], left);
      p[o + RIGHT] = Math.max(p[o + RIGHT], right);
      if (--h[hl] <= 0 || left >= p[o + HOLD_LEFT]) {
        p[o + HOLD_LEFT] = left;
        h[hl] = sampleRate * PEAK_METER.holdSeconds;
      }
      if (--h[hr] <= 0 || right >= p[o + HOLD_RIGHT]) {
        p[o + HOLD_RIGHT] = right;
        h[hr] = sampleRate * PEAK_METER.holdSeconds;
      }
      if (left >= PEAK_METER.overload || right >= PEAK_METER.overload) p[o + OVERLOAD] = 1;
    }
  }
}
registerProcessor(MULTI_METER.name, MultiPeakMeterProcessor);
